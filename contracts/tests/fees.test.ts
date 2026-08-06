import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const _USDC_DECIMALS = 6;

describe("Fees (maker/taker)", () => {
  it("should NOT charge fees on a plain resting order", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: seller.account,
    });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(feesAfter - feesBefore, 0n);
    assert.equal(sellerBalanceAfter, sellerBalanceBefore);
  });

  it("should charge taker on fill and not the maker when makerFee is 0", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const takerFeeBps = 100; // 1% — MAX_FEE_BPS, the largest visible balance change allowed
    await futures.write.setTakerFeeBps([takerFeeBps], { account: owner.account });

    const price = await futures.read.getMarketPrice();
    const notional = price * 1n;
    const expectedFee = (notional * BigInt(takerFeeBps)) / 10_000n;
    const margin = price * 10n + expectedFee;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceAfter, sellerBalanceBefore); // maker pays makerFee=0
    assert.equal(buyerBalanceBefore - buyerBalanceAfter, expectedFee);
    assert.equal(feesAfter - feesBefore, expectedFee);
  });

  it("should charge both maker and taker on a fill when both fees are set", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const makerFeeBps = 60; // 0.6%
    const takerFeeBps = 100; // 1% (MAX_FEE_BPS)
    await futures.write.setMakerFeeBps([makerFeeBps], { account: owner.account });
    await futures.write.setTakerFeeBps([takerFeeBps], { account: owner.account });

    const price = await futures.read.getMarketPrice();
    const notional = price * 1n;
    const expectedMakerFee = (notional * BigInt(makerFeeBps)) / 10_000n;
    const expectedTakerFee = (notional * BigInt(takerFeeBps)) / 10_000n;
    const margin = price * 10n + expectedMakerFee + expectedTakerFee;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceBefore - sellerBalanceAfter, expectedMakerFee);
    assert.equal(buyerBalanceBefore - buyerBalanceAfter, expectedTakerFee);
    assert.equal(feesAfter - feesBefore, expectedMakerFee + expectedTakerFee);
  });

  it("should NOT charge fees when a participant self-cancels via opposite-side qty", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: seller.account,
    });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceAfter, sellerBalanceBefore);
    assert.equal(feesAfter, feesBefore);
  });

  it("emits MakerFeeBpsUpdated / TakerFeeBpsUpdated when fees are set", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, pc } = accounts;

    const makerTx = await futures.write.setMakerFeeBps([50], { account: owner.account });
    const makerReceipt = await pc.waitForTransactionReceipt({ hash: makerTx });
    const [makerEvent] = parseEventLogs({
      logs: makerReceipt.logs,
      abi: futures.abi,
      eventName: "MakerFeeBpsUpdated",
    });
    assert.equal(makerEvent.args.newMakerFeeBps, 50);

    const takerTx = await futures.write.setTakerFeeBps([30], { account: owner.account });
    const takerReceipt = await pc.waitForTransactionReceipt({ hash: takerTx });
    const [takerEvent] = parseEventLogs({
      logs: takerReceipt.logs,
      abi: futures.abi,
      eventName: "TakerFeeBpsUpdated",
    });
    assert.equal(takerEvent.args.newTakerFeeBps, 30);

    assert.equal(await futures.read.makerFeeBps(), 50);
    assert.equal(await futures.read.takerFeeBps(), 30);
  });

  it("accepts a fee at MAX_FEE_BPS and rejects one bp beyond it", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    await futures.write.setTakerFeeBps([100], { account: owner.account });
    assert.equal(await futures.read.takerFeeBps(), 100);

    await viem.assertions.revertWithCustomError(
      futures.write.setTakerFeeBps([101], { account: owner.account }),
      futures,
      "InvalidFee",
    );
    // 5% would exactly match the MM spot shock, collapsing the coverage argument the
    // cap exists to protect.
    await viem.assertions.revertWithCustomError(
      futures.write.setMakerFeeBps([500], { account: owner.account }),
      futures,
      "InvalidFee",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.setMakerFeeBps([-101], { account: owner.account }),
      futures,
      "InvalidFee",
    );
  });

  it("rejects a maker rebate that makes the pair a net outflow", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    await futures.write.setTakerFeeBps([30], { account: owner.account });
    // −30 nets to zero and is fine; −31 would pay out more than the match collects.
    await futures.write.setMakerFeeBps([-30], { account: owner.account });
    await viem.assertions.revertWithCustomError(
      futures.write.setMakerFeeBps([-31], { account: owner.account }),
      futures,
      "InvalidFee",
    );
    // Same bound seen from the taker side: lowering the taker fee under the standing
    // rebate is equally an outflow.
    await viem.assertions.revertWithCustomError(
      futures.write.setTakerFeeBps([29], { account: owner.account }),
      futures,
      "InvalidFee",
    );
  });

  it("pays a maker rebate out of the collected-fee pot on the signed path", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    const margin = price * 20n;

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    // Fill once at a flat 100 bps taker fee to stock the pot.
    await futures.write.setTakerFeeBps([100], { account: owner.account });
    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const potAfterFirst = await futures.read.collectedFeesBalance();
    assert.ok(potAfterFirst > 0n);

    // Now rebate the maker. The former `uint16` cast read −20 bps as 65516 bps and
    // charged the maker 655% of notional instead of paying 0.2%.
    await futures.write.setMakerFeeBps([-20], { account: owner.account });
    const expectedRebate = (price * 20n) / 10_000n;
    assert.ok(expectedRebate > 0n);

    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const makerBefore = await collateralVault.read.balanceOf([seller.account.address]);
    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const makerAfter = await collateralVault.read.balanceOf([seller.account.address]);

    assert.equal(makerAfter - makerBefore, expectedRebate, "maker is paid, not charged");
    assert.equal(
      await futures.read.collectedFeesBalance(),
      potAfterFirst + (price * 100n) / 10_000n - expectedRebate,
      "the rebate is drawn from the pot",
    );
  });

  it("should reject non-owner attempts to set maker/taker fees", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.setMakerFeeBps([50], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.setTakerFeeBps([30], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
  });

  it("should allow only owner to withdraw collected fees", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.withdrawCollectedFees({ account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
  });

  it("should withdraw the correct amount of accrued fees", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, usdcMock, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const takerFeeBps = 100; // 1% (MAX_FEE_BPS)
    await futures.write.setTakerFeeBps([takerFeeBps], { account: owner.account });

    const price = await futures.read.getMarketPrice();
    const notional = price * 1n;
    const expectedFee = (notional * BigInt(takerFeeBps)) / 10_000n;
    const margin = price * 10n + expectedFee;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });

    const feesAccrued = await futures.read.collectedFeesBalance();
    assert.equal(feesAccrued, expectedFee);

    const ownerBalanceBefore = await usdcMock.read.balanceOf([owner.account.address]);
    await futures.write.withdrawCollectedFees({ account: owner.account });
    const ownerBalanceAfter = await usdcMock.read.balanceOf([owner.account.address]);

    assert.equal(await futures.read.collectedFeesBalance(), 0n);
    assert.equal(ownerBalanceAfter - ownerBalanceBefore, feesAccrued);
  });
});
