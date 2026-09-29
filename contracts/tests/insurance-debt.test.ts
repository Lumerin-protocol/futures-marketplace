import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice, scaleHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";
import { getUserOrders } from "./lib/viewHelpers.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const ENTRY = parseUnits("100", 6);

async function createdOrder(
  futures: FuturesFixture["contracts"]["futures"],
  pc: FuturesFixture["accounts"]["pc"],
  account: FuturesFixture["accounts"]["seller"],
  args: readonly [bigint, bigint, bigint, number],
) {
  const hash = await futures.write.createOrder([args[0], args[1], args[2], args[3]], { account: account.account });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  const [created] = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "OrderCreated" });
  return created.args.orderId;
}

async function openLot(data: FuturesFixture, entryPrice: bigint, expirationAt: bigint) {
  const { futures } = data.contracts;
  const { seller, buyer } = data.accounts;
  await futures.write.createOrder([entryPrice, expirationAt, -1n, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([entryPrice, expirationAt, 1n, TimeInForce.GTC], {
    account: buyer.account,
  });
}

async function drainFund(
  collateralVault: FuturesFixture["contracts"]["collateralVault"],
  owner: FuturesFixture["accounts"]["owner"],
) {
  const fund = await collateralVault.read.insuranceFundBalance();
  await collateralVault.write.withdrawInsuranceFund([owner.account.address, fund], {
    account: owner.account,
  });
}

describe("Futures insurance-fund debt", () => {
  it("pays a winning settlement in full from an empty fund and the loser repays it", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { seller, buyer, owner, tc } = accounts;
    const deliveryDate = config.deliveryDates[0];
    const entry = quantizePrice(ENTRY, config.priceLadderStep);
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await openLot(data, entry, deliveryDate);
    await drainFund(collateralVault, owner);
    await collateralVault.write.setInsuranceDebtCap([parseUnits("1000000", 6)], {
      account: owner.account,
    });

    await refreshHashprice(hashpriceUsd, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    await futures.write.recordSettlementPrice([deliveryDate], { account: seller.account });
    const pinned = await futures.read.settlementPrice([deliveryDate]);
    const profit = entry - pinned;
    assert.ok(profit > 0n);

    const sellerBefore = await collateralVault.read.balanceOf([seller.account.address]);
    await futures.write.settlePosition([seller.account.address, deliveryDate], {
      account: seller.account,
    });
    assert.equal(
      (await collateralVault.read.balanceOf([seller.account.address])) - sellerBefore,
      profit,
    );
    assert.equal(await collateralVault.read.insuranceDebt(), profit);
    assert.equal(await collateralVault.read.timingDebt(), profit);
    assert.equal(await collateralVault.read.uncoveredLoss(), 0n);
    assert.equal(await collateralVault.read.halted(), false);

    await futures.write.settlePosition([buyer.account.address, deliveryDate], {
      account: buyer.account,
    });
    assert.equal(await collateralVault.read.insuranceDebt(), 0n);
    assert.equal(await collateralVault.read.insuranceFundBalance(), 0n);
    assert.equal(await collateralVault.read.timingDebt(), 0n);
  });

  it("halts when a winning settlement crosses the cap and keeps risk-reducing paths open", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { seller, buyer, buyer2, owner, tc, pc } = accounts;
    const deliveryDate = config.deliveryDates[0];
    const later = config.deliveryDates[1];
    const entry = quantizePrice(ENTRY, config.priceLadderStep);
    const margin = parseUnits("10000", 6);
    const step = config.priceLadderStep;

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await collateralVault.write.deposit([margin], { account: buyer2.account });
    await openLot(data, entry, deliveryDate);

    const restingAsk = quantizePrice(entry + 10n * step, step);
    const restingBid = quantizePrice(step * 2n, step);
    const reduceId = await createdOrder(
      futures,
      pc,
      seller,
      [restingAsk, later, -2n, TimeInForce.GTC],
    );
    const cancelId = await createdOrder(
      futures,
      pc,
      seller,
      [restingAsk + step, later, -1n, TimeInForce.GTC],
    );
    const outdatedId = await createdOrder(
      futures,
      pc,
      buyer2,
      [restingBid, deliveryDate, 1n, TimeInForce.GTC],
    );

    await drainFund(collateralVault, owner);
    await refreshHashprice(hashpriceUsd, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    await futures.write.recordSettlementPrice([deliveryDate], { account: seller.account });
    const pinned = await futures.read.settlementPrice([deliveryDate]);
    const profit = entry - pinned;
    await collateralVault.write.setInsuranceDebtCap([profit - 1n], { account: owner.account });

    await futures.write.settlePosition([seller.account.address, deliveryDate], {
      account: seller.account,
    });
    assert.equal(await collateralVault.read.insuranceDebt(), profit);
    assert.equal(await collateralVault.read.halted(), true);

    const create = {
      price: restingAsk,
      expirationAt: later,
      quantity: -1n,
      timeInForce: TimeInForce.GTC,
    };
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([restingAsk, later, -1n, TimeInForce.GTC], { account: seller.account }),
      futures,
      "TradingHalted",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.createOrders([[create]], { account: seller.account }),
      futures,
      "TradingHalted",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.updateOrders([[], [], [create]], { account: seller.account }),
      futures,
      "TradingHalted",
    );
    await viem.assertions.revertWithCustomError(
      collateralVault.write.withdraw([1n], { account: seller.account }),
      collateralVault,
      "Halted",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.withdrawCollectedFees({ account: owner.account }),
      collateralVault,
      "Halted",
    );

    await futures.write.reduceOrderSize([reduceId, -1n], { account: seller.account });
    await futures.write.updateOrders([[cancelId], [], []], { account: seller.account });
    await futures.write.cancelOrder([reduceId], { account: seller.account });

    await collateralVault.write.depositFor([buyer.account.address, 1n], { account: owner.account });
    await futures.write.setMakerFeeBps([0], { account: owner.account });

    await futures.write.settlePosition([buyer.account.address, deliveryDate], {
      account: buyer.account,
    });
    assert.equal(await collateralVault.read.insuranceDebt(), 0n);
    assert.equal(await collateralVault.read.halted(), true);

    const { timestamp } = await pc.getBlock({ blockTag: "latest" });
    const pastExpiry = timestamp + 10n;
    await refreshHashprice(hashpriceUsd, pastExpiry);
    await tc.setNextBlockTimestamp({ timestamp: pastExpiry });
    await futures.write.removeOutdatedOrders([[outdatedId]], { account: buyer2.account });
    assert.deepEqual(await getUserOrders(futures, buyer2.account.address), []);

    await collateralVault.write.depositInsuranceFund([1n], { account: owner.account });
    await collateralVault.write.resume({ account: owner.account });
    assert.equal(await collateralVault.read.halted(), false);

    await futures.write.createOrder([restingAsk, later, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await collateralVault.write.withdraw([1n], { account: buyer.account });

    await collateralVault.write.halt({ account: owner.account });
    assert.equal(await collateralVault.read.halted(), true);
    await collateralVault.write.resume({ account: owner.account });
    assert.equal(await collateralVault.read.halted(), false);
  });

  it("records a late liquidation shortfall on the vault", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashpriceUsd, portfolioMarginEngine } = contracts;
    const { seller, buyer, buyer2, owner, pc } = accounts;
    const deliveryDate = config.deliveryDates[0];
    const entry = await futures.read.getMarketPrice();

    await collateralVault.write.setInsuranceDebtCap([parseUnits("1000000", 6)], {
      account: owner.account,
    });
    const buyerDeposit = (entry * 25n) / 100n;
    await collateralVault.write.deposit([entry * 10n], { account: seller.account });
    await collateralVault.write.deposit([buyerDeposit], { account: buyer.account });
    await futures.write.createOrder([entry, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([entry, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });

    await scaleHashprice(hashpriceUsd, 1n, 2n);
    assert.equal(await portfolioMarginEngine.read.isLiquidatable([buyer.account.address]), true);

    await collateralVault.write.halt({ account: owner.account });
    const hash = await futures.write.liquidatePositions(
      [buyer.account.address, [deliveryDate], [1n]],
      { account: buyer2.account },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash });
    const badDebt = parseEventLogs({
      logs: receipt.logs,
      abi: collateralVault.abi,
      eventName: "BadDebt",
    });
    assert.ok(badDebt.length >= 1);
    assert.equal(badDebt[0].args.payer.toLowerCase(), buyer.account.address.toLowerCase());
    assert.equal(await collateralVault.read.halted(), true);
    assert.equal(
      (await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity,
      0n,
    );
  });
});
