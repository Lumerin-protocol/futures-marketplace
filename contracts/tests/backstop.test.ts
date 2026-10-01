import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits, zeroHash } from "viem";
import type { NetworkConnection } from "hardhat/types/network";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice, scaleHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const BPS = 10_000n;

/**
 * Protocol backstop: liquidation hands the closed quantity to `BACKSTOP` as an explicit
 * position, and anyone can shrink that position through `unwindBackstop`.
 *
 * Fixture mirrors liquidate-positions.test.ts: IM 20% / MM 10%, zero trading fees, `buyer`
 * long 10 vs `seller`, plus a foreign `buyer2` long 1 vs `seller`. A 15% crash makes the
 * buyer liquidatable while leaving a recoverable band.
 */
async function backstopFixture(_conn: NetworkConnection) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, portfolioMarginEngine, collateralVault } = contracts;
  const { seller, buyer, buyer2, owner } = accounts;

  await portfolioMarginEngine.write.setShocks(
    [parseUnits("0.20", 18), parseUnits("0.10", 18), 0n, 0n],
    { account: owner.account },
  );
  await futures.write.setMakerFeeBps([0], { account: owner.account });
  await futures.write.setTakerFeeBps([0], { account: owner.account });

  const entry = await futures.read.getMarketPrice();
  const deliveryDate = config.deliveryDates[0];
  const lotCount = 10n;

  await collateralVault.write.deposit([(entry * 22n) / 10n], { account: buyer.account });
  await collateralVault.write.deposit([entry * 100n], { account: seller.account });
  await collateralVault.write.deposit([entry * 100n], { account: buyer2.account });

  await futures.write.createOrder([entry, deliveryDate, -lotCount, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([entry, deliveryDate, lotCount, TimeInForce.GTC], {
    account: buyer.account,
  });
  await futures.write.createOrder([entry, deliveryDate, -1n, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([entry, deliveryDate, 1n, TimeInForce.GTC], {
    account: buyer2.account,
  });

  const backstop = await futures.read.BACKSTOP();

  return {
    ...data,
    backstop,
    config: { ...config, entry, deliveryDate, lotCount },
    async makeUnderwater() {
      await scaleHashprice(contracts.hashpriceUsd, 85n, 100n);
    },
    /** Sum of every participant's net at `deliveryDate`, backstop included. */
    async netSum() {
      let sum = 0n;
      for (const who of [seller.account.address, buyer.account.address, buyer2.account.address, backstop]) {
        sum += (await futures.read.getUserPosition([who, deliveryDate])).netQuantity;
      }
      return sum;
    },
    /** Liquidate the buyer's whole leg so the backstop holds `lotCount` long at the mark. */
    async handOffAll() {
      await this.makeUnderwater();
      const mark = await futures.read.getMarketPrice();
      await futures.write.liquidatePositions([buyer.account.address, [deliveryDate], [lotCount]], {
        account: buyer2.account,
      });
      return mark;
    },
  };
}

describe("Futures - protocol backstop", function () {
  it("exposes the vault's backstop vanity address", async function () {
    const data = await networkHelpers.loadFixture(backstopFixture);
    assert.equal(
      getAddress(data.backstop),
      getAddress(await data.contracts.collateralVault.read.BACKSTOP_ADDR()),
    );
  });

  describe("liquidation hand-off", function () {
    it("gives the backstop the liquidated quantity at the mark and keeps nets summing to zero", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures } = data.contracts;
      const { buyer, buyer2, seller, pc } = data.accounts;
      const { deliveryDate, lotCount } = data.config;

      assert.equal(await data.netSum(), 0n);
      await data.makeUnderwater();
      const mark = await futures.read.getMarketPrice();

      const closeQty = 2n;
      const hash = await futures.write.liquidatePositions(
        [buyer.account.address, [deliveryDate], [closeQty]],
        { account: buyer2.account },
      );
      const receipt = await pc.waitForTransactionReceipt({ hash });

      const backstopPos = await futures.read.getUserPosition([data.backstop, deliveryDate]);
      assert.equal(backstopPos.netQuantity, closeQty, "backstop inherits the user's side");
      assert.equal(backstopPos.netEntryValue, mark * closeQty, "booked at the liquidation mark");

      const buyerPos = await futures.read.getUserPosition([buyer.account.address, deliveryDate]);
      assert.equal(buyerPos.netQuantity, lotCount - closeQty);
      const sellerPos = await futures.read.getUserPosition([seller.account.address, deliveryDate]);
      assert.equal(sellerPos.netQuantity, -lotCount - 1n, "counterparties untouched");
      assert.equal(await data.netSum(), 0n, "conservation across users + backstop");

      const [assigned] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "BackstopAssigned",
      });
      assert.equal(getAddress(assigned.args.user), getAddress(buyer.account.address));
      assert.equal(assigned.args.expirationAt, deliveryDate);
      assert.equal(assigned.args.quantity, closeQty);
      assert.equal(assigned.args.price, mark);
    });

    it("full close moves the whole leg without touching the backstop's collateral", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault } = data.contracts;
      const { buyer } = data.accounts;
      const { deliveryDate, lotCount } = data.config;

      const mark = await data.handOffAll();

      const backstopPos = await futures.read.getUserPosition([data.backstop, deliveryDate]);
      assert.equal(backstopPos.netQuantity, lotCount);
      assert.equal(backstopPos.netEntryValue, mark * lotCount);
      assert.equal(
        (await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity,
        0n,
      );
      assert.equal(await collateralVault.read.balanceOf([data.backstop]), 0n, "hand-off costs nothing");
      assert.equal(await data.netSum(), 0n);
    });

    it("an opposite hand-off nets against the backstop's existing leg", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault, hashpriceUsd, portfolioMarginEngine } = data.contracts;
      const { seller, buyer2 } = data.accounts;
      const { deliveryDate, lotCount } = data.config;

      // Backstop long 10 after the buyer's liquidation.
      await data.handOffAll();

      // Now rally so the seller (short 11) becomes liquidatable: thin their collateral first.
      const sellerBal = await collateralVault.read.balanceOf([seller.account.address]);
      await collateralVault.write.withdraw([sellerBal - (await futures.read.getMarketPrice()) * 3n], {
        account: seller.account,
      });
      await scaleHashprice(hashpriceUsd, 150n, 100n);
      assert.equal(await portfolioMarginEngine.read.isLiquidatable([seller.account.address]), true);

      const closeQty = 4n;
      await futures.write.liquidatePositions([seller.account.address, [deliveryDate], [closeQty]], {
        account: buyer2.account,
      });

      const backstopPos = await futures.read.getUserPosition([data.backstop, deliveryDate]);
      assert.equal(backstopPos.netQuantity, lotCount - closeQty, "short hand-off nets the long");
      assert.equal(await data.netSum(), 0n);
    });
  });

  describe("unwindBackstop", function () {
    it("sells into a resting bid inside the band and pays the caller from the fee pot", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault } = data.contracts;
      const { owner, seller, buyer2, pc } = data.accounts;
      const { deliveryDate, lotCount, priceLadderStep } = data.config;

      await data.handOffAll();
      const bandBps = 100;
      const feeBps = 10;
      await collateralVault.write.setBackstopParams([bandBps, feeBps], { account: owner.account });
      const pot = parseUnits("50", 6);
      await collateralVault.write.depositFor([futures.address, pot], { account: owner.account });

      const mark = await futures.read.getMarketPrice();
      // Seller (short 11) bids at the mark; backstop sells into it.
      const bidQty = 3n;
      await futures.write.createOrder([mark, deliveryDate, bidQty, TimeInForce.GTC], {
        account: seller.account,
      });

      const callerBefore = await collateralVault.read.balanceOf([buyer2.account.address]);
      const hash = await futures.write.unwindBackstop([deliveryDate, bidQty], { account: buyer2.account });
      const receipt = await pc.waitForTransactionReceipt({ hash });

      const backstopPos = await futures.read.getUserPosition([data.backstop, deliveryDate]);
      assert.equal(backstopPos.netQuantity, lotCount - bidQty);
      assert.equal(
        (await futures.read.getUserPosition([seller.account.address, deliveryDate])).netQuantity,
        -lotCount - 1n + bidQty,
      );
      assert.equal(await data.netSum(), 0n);

      const expectedFee = (mark * bidQty * BigInt(feeBps)) / BPS;
      assert.ok(expectedFee > 0n);
      assert.equal(
        (await collateralVault.read.balanceOf([buyer2.account.address])) - callerBefore,
        expectedFee,
        "caller receives the unwind fee",
      );
      assert.equal(await futures.read.collectedFeesBalance(), pot - expectedFee, "paid from the fee pot");

      const [unwound] = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "BackstopUnwound" });
      assert.equal(getAddress(unwound.args.caller), getAddress(buyer2.account.address));
      assert.equal(unwound.args.expirationAt, deliveryDate);
      assert.equal(unwound.args.filledQuantity, -bidQty);
      assert.equal(unwound.args.fee, expectedFee);

      // Emitted like an IOC from the backstop, limited to the band edge (tick-aligned toward the mark).
      const [created] = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "OrderCreated" });
      assert.equal(getAddress(created.args.participant), getAddress(data.backstop));
      assert.equal(created.args.quantity, -bidQty);
      const offset = (mark * BigInt(bandBps)) / BPS;
      const rawLimit = mark - offset + priceLadderStep - 1n;
      assert.equal(created.args.price, (rawLimit / priceLadderStep) * priceLadderStep);
      assert.ok(created.args.price >= mark - offset && created.args.price <= mark);
    });

    it("fills partially when the book is thinner than the request", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures } = data.contracts;
      const { seller, buyer2, pc } = data.accounts;
      const { deliveryDate, lotCount } = data.config;

      await data.handOffAll();
      const mark = await futures.read.getMarketPrice();
      await futures.write.createOrder([mark, deliveryDate, 2n, TimeInForce.GTC], { account: seller.account });

      const hash = await futures.write.unwindBackstop([deliveryDate, lotCount], { account: buyer2.account });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      const [unwound] = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "BackstopUnwound" });
      assert.equal(unwound.args.filledQuantity, -2n);
      assert.equal(unwound.args.fee, 0n, "zero fee bps and empty pot");
      assert.equal(
        (await futures.read.getUserPosition([data.backstop, deliveryDate])).netQuantity,
        lotCount - 2n,
      );
    });

    it("reverts TimeInForceNotFilled when the only liquidity sits outside the band", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault } = data.contracts;
      const { owner, seller, buyer2 } = data.accounts;
      const { deliveryDate, priceLadderStep } = data.config;

      await data.handOffAll();
      await collateralVault.write.setBackstopParams([100, 0], { account: owner.account });
      const mark = await futures.read.getMarketPrice();
      const farBid = ((mark * 90n) / 100n / priceLadderStep) * priceLadderStep;
      await futures.write.createOrder([farBid, deliveryDate, 5n, TimeInForce.GTC], { account: seller.account });

      await viem.assertions.revertWithCustomError(
        futures.write.unwindBackstop([deliveryDate, 1n], { account: buyer2.account }),
        futures,
        "TimeInForceNotFilled",
      );
    });

    it("caps the caller fee at the fee pot balance", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault } = data.contracts;
      const { owner, seller, buyer2, pc } = data.accounts;
      const { deliveryDate } = data.config;

      await data.handOffAll();
      await collateralVault.write.setBackstopParams([100, 2_500], { account: owner.account });
      const pot = 7n;
      await collateralVault.write.depositFor([futures.address, pot], { account: owner.account });
      const mark = await futures.read.getMarketPrice();
      await futures.write.createOrder([mark, deliveryDate, 1n, TimeInForce.GTC], { account: seller.account });

      const hash = await futures.write.unwindBackstop([deliveryDate, 1n], { account: buyer2.account });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      const [unwound] = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "BackstopUnwound" });
      assert.equal(unwound.args.fee, pot);
      assert.equal(await futures.read.collectedFeesBalance(), 0n);
    });

    it("charges the backstop no taker fee", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault } = data.contracts;
      const { owner, seller, buyer2, pc } = data.accounts;
      const { deliveryDate } = data.config;

      await data.handOffAll();
      await futures.write.setTakerFeeBps([100], { account: owner.account });
      const mark = await futures.read.getMarketPrice();
      await futures.write.createOrder([mark, deliveryDate, 2n, TimeInForce.GTC], { account: seller.account });

      const hash = await futures.write.unwindBackstop([deliveryDate, 2n], { account: buyer2.account });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      const badDebt = parseEventLogs({ logs: receipt.logs, abi: collateralVault.abi, eventName: "BadDebt" });
      assert.equal(badDebt.length, 0, "an unfunded backstop would otherwise record BadDebt on a fee");
      assert.equal(await collateralVault.read.balanceOf([data.backstop]), 0n);
    });

    it("stays open while the vault is halted", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault } = data.contracts;
      const { owner, seller, buyer2 } = data.accounts;
      const { deliveryDate, lotCount } = data.config;

      await data.handOffAll();
      const mark = await futures.read.getMarketPrice();
      await futures.write.createOrder([mark, deliveryDate, 1n, TimeInForce.GTC], { account: seller.account });
      await collateralVault.write.halt({ account: owner.account });

      await futures.write.unwindBackstop([deliveryDate, 1n], { account: buyer2.account });
      assert.equal(
        (await futures.read.getUserPosition([data.backstop, deliveryDate])).netQuantity,
        lotCount - 1n,
      );
    });

    it("rejects zero quantity, a flat backstop, and an unlisted expiry", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures } = data.contracts;
      const { buyer2 } = data.accounts;
      const { deliveryDate } = data.config;

      await viem.assertions.revertWithCustomError(
        futures.write.unwindBackstop([deliveryDate, 1n], { account: buyer2.account }),
        futures,
        "PositionNotExists",
      );
      await viem.assertions.revertWithCustomError(
        futures.write.unwindBackstop([deliveryDate, 0n], { account: buyer2.account }),
        futures,
        "InvalidQty",
      );
      await viem.assertions.revertWithCustomError(
        futures.write.unwindBackstop([12345n, 1n], { account: buyer2.account }),
        futures,
        "ExpirationDateNotAvailable",
      );
    });
  });

  describe("guards", function () {
    it("liquidation entry points refuse the backstop account", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures } = data.contracts;
      const { buyer2 } = data.accounts;
      const { deliveryDate } = data.config;

      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrder([data.backstop, zeroHash], { account: buyer2.account }),
        futures,
        "BackstopAccount",
      );
      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrders([data.backstop, [zeroHash]], { account: buyer2.account }),
        futures,
        "BackstopAccount",
      );
      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([data.backstop, deliveryDate, 1n], { account: buyer2.account }),
        futures,
        "BackstopAccount",
      );
      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePositions([data.backstop, [deliveryDate], [1n]], { account: buyer2.account }),
        futures,
        "BackstopAccount",
      );
    });

    it("refuses to liquidate a matured leg at the live mark", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, hashpriceUsd } = data.contracts;
      const { buyer, buyer2, tc } = data.accounts;
      const { deliveryDate, lotCount } = data.config;

      await data.makeUnderwater();
      await refreshHashprice(hashpriceUsd, deliveryDate);
      await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer.account.address, deliveryDate, 1n], { account: buyer2.account }),
        futures,
        "PositionMatured",
      );
      // The batch form skips the matured leg; with nothing else to close it reports NotLiquidatable.
      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePositions([buyer.account.address, [deliveryDate], [lotCount]], {
          account: buyer2.account,
        }),
        futures,
        "NotLiquidatable",
      );
    });
  });

  describe("settlement at expiry", function () {
    it("a losing backstop leg records BadDebt against the backstop; a winning one accrues withdrawable balance", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault, hashpriceUsd } = data.contracts;
      const { seller, buyer2, tc, pc } = data.accounts;
      const { deliveryDate, lotCount } = data.config;

      const mark = await data.handOffAll();
      // Price keeps falling: the backstop's long loses.
      await scaleHashprice(hashpriceUsd, 90n, 100n);
      await refreshHashprice(hashpriceUsd, deliveryDate);
      await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
      await futures.write.recordSettlementPrice([deliveryDate], { account: buyer2.account });
      const pinned = await futures.read.settlementPrice([deliveryDate]);
      assert.ok(pinned < mark);

      const debtBefore = await collateralVault.read.traderBadDebtTotal();
      const hash = await futures.write.settlePosition([data.backstop, deliveryDate], { account: buyer2.account });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      const badDebt = parseEventLogs({ logs: receipt.logs, abi: collateralVault.abi, eventName: "BadDebt" });
      assert.equal(badDebt.length, 1);
      assert.equal(getAddress(badDebt[0].args.payer), getAddress(data.backstop));
      assert.equal(badDebt[0].args.amount, (mark - pinned) * lotCount);
      assert.equal((await collateralVault.read.traderBadDebtTotal()) - debtBefore, (mark - pinned) * lotCount);
      assert.equal((await futures.read.getUserPosition([data.backstop, deliveryDate])).netQuantity, 0n);

      // The remaining users settle against the fund as usual; everything nets to zero.
      await futures.write.settlePositions(
        [[seller.account.address, buyer2.account.address], [deliveryDate, deliveryDate]],
        { account: seller.account },
      );
      assert.equal(await data.netSum(), 0n);
    });

    it("a winning backstop leg is withdrawable by the owner", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault, hashpriceUsd, usdcMock } = data.contracts;
      const { owner, buyer2, tc } = data.accounts;
      const { deliveryDate, lotCount } = data.config;

      const mark = await data.handOffAll();
      await scaleHashprice(hashpriceUsd, 120n, 100n);
      await refreshHashprice(hashpriceUsd, deliveryDate);
      await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
      await futures.write.recordSettlementPrice([deliveryDate], { account: buyer2.account });
      const pinned = await futures.read.settlementPrice([deliveryDate]);
      assert.ok(pinned > mark);

      await futures.write.settlePosition([data.backstop, deliveryDate], { account: buyer2.account });
      const profit = (pinned - mark) * lotCount;
      assert.equal(await collateralVault.read.balanceOf([data.backstop]), profit);

      // `withdrawBackstop` pays the recipient in USDC, like the insurance-fund withdrawal.
      const ownerBefore = await usdcMock.read.balanceOf([owner.account.address]);
      await collateralVault.write.withdrawBackstop([owner.account.address, profit], { account: owner.account });
      assert.equal((await usdcMock.read.balanceOf([owner.account.address])) - ownerBefore, profit);
      assert.equal(await collateralVault.read.balanceOf([data.backstop]), 0n);
    });
  });

  describe("forceClosePositions", function () {
    it("only runs while halted and with matching arrays", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault } = data.contracts;
      const { owner, buyer, seller } = data.accounts;
      const { deliveryDate } = data.config;

      await viem.assertions.revertWithCustomError(
        futures.write.forceClosePositions([[buyer.account.address], [deliveryDate]], { account: owner.account }),
        futures,
        "NotHalted",
      );
      await viem.assertions.revertWithCustomError(
        futures.write.forceClosePositions([[buyer.account.address], [deliveryDate]], { account: seller.account }),
        futures,
        "OwnableUnauthorizedAccount",
      );
      await collateralVault.write.halt({ account: owner.account });
      await viem.assertions.revertWithCustomError(
        futures.write.forceClosePositions([[buyer.account.address], []], { account: owner.account }),
        futures,
        "ArrayLengthMismatch",
      );
    });

    it("closes each leg at the mark with no fee and no backstop hand-off", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault } = data.contracts;
      const { owner, buyer, buyer2, seller, pc } = data.accounts;
      const { deliveryDate, lotCount, entry } = data.config;

      await collateralVault.write.halt({ account: owner.account });
      const fundBefore = await collateralVault.read.insuranceFundBalance();
      const mark = await futures.read.getMarketPrice();
      const users = [seller.account.address, buyer.account.address, buyer2.account.address];
      const hash = await futures.write.forceClosePositions(
        [users, [deliveryDate, deliveryDate, deliveryDate]],
        { account: owner.account },
      );
      const receipt = await pc.waitForTransactionReceipt({ hash });

      for (const who of [...users, data.backstop]) {
        assert.equal((await futures.read.getUserPosition([who, deliveryDate])).netQuantity, 0n);
      }
      const liquidated = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "PositionLiquidated" });
      assert.equal(liquidated.length, 3);
      const bySeller = liquidated.find((e) => getAddress(e.args.user) === getAddress(seller.account.address));
      assert.ok(bySeller);
      assert.equal(bySeller.args.closedQuantity, -lotCount - 1n);
      assert.equal(bySeller.args.liquidatorFee, 0n);
      assert.equal(bySeller.args.pnl, (entry - mark) * (lotCount + 1n));
      assert.equal(
        parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "BackstopAssigned" }).length,
        0,
      );
      // All PnL netted through the fund: with equal marks the fund is back where it started.
      assert.equal(await collateralVault.read.insuranceFundBalance(), fundBefore);
    });

    it("skips empty legs and refuses matured ones", async function () {
      const data = await networkHelpers.loadFixture(backstopFixture);
      const { futures, collateralVault, hashpriceUsd } = data.contracts;
      const { owner, buyer, tc } = data.accounts;
      const { deliveryDate, deliveryDates } = data.config;

      await collateralVault.write.halt({ account: owner.account });
      // Empty leg at another expiry: no-op, no event.
      await futures.write.forceClosePositions([[buyer.account.address], [deliveryDates[1]]], {
        account: owner.account,
      });

      await refreshHashprice(hashpriceUsd, deliveryDate);
      await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
      await viem.assertions.revertWithCustomError(
        futures.write.forceClosePositions([[buyer.account.address], [deliveryDate]], { account: owner.account }),
        futures,
        "PositionMatured",
      );
    });
  });
});
