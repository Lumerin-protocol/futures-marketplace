import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

async function positionWithMarginFixture() {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, collateralVault } = contracts;
  const { seller, buyer } = accounts;

  const entryPricePerDay = await futures.read.getMarketPrice();
  const margin = entryPricePerDay * 2n;
  const deliveryDate = config.deliveryDates[0];

  await collateralVault.write.deposit([margin], { account: seller.account });
  await collateralVault.write.deposit([margin], { account: buyer.account });

  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", -1], {
    account: seller.account,
  });
  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", 1], {
    account: buyer.account,
  });

  return {
    ...data,
    entryPricePerDay,
    margin,
    deliveryDate,
  };
}

describe("Futures - getMinMargin", () => {
  it("should return larger value when buyer is at loss", async () => {
    const { contracts, accounts } = await positionWithMarginFixture();
    const { futures, hashrateOracle, collateralVault } = contracts;
    const { buyer, seller } = accounts;

    const buyerMargin = await futures.read.getMinMargin([buyer.account.address]);
    const sellerMargin = await futures.read.getMinMargin([seller.account.address]);

    assert.equal(sellerMargin, buyerMargin); // at market price only

    const marketPricePerDay = await futures.read.getMarketPrice();
    await scaleHashprice(hashrateOracle, 100n, 110n); // drop ~9.09%
    const newMarketPricePerDay = await futures.read.getMarketPrice();

    assert.ok(newMarketPricePerDay < marketPricePerDay);
    const buyerMargin2 = await futures.read.getMinMargin([buyer.account.address]);
    const sellerMargin2 = await futures.read.getMinMargin([seller.account.address]);

    assert.ok(buyerMargin2 > buyerMargin);
    assert.ok(sellerMargin2 < sellerMargin);
  });

  it("should return smaller value when buyer is at profit", async () => {
    const { contracts, accounts } = await positionWithMarginFixture();
    const { futures, hashrateOracle, collateralVault } = contracts;
    const { buyer, seller } = accounts;

    const buyerMargin = await futures.read.getMinMargin([buyer.account.address]);
    const sellerMargin = await futures.read.getMinMargin([seller.account.address]);

    assert.equal(sellerMargin, buyerMargin); // at market price only

    const marketPricePerDay = await futures.read.getMarketPrice();
    await scaleHashprice(hashrateOracle, 100n, 90n); // raise ~11.11%
    const newMarketPricePerDay = await futures.read.getMarketPrice();

    assert.ok(newMarketPricePerDay > marketPricePerDay);
    const buyerMargin2 = await futures.read.getMinMargin([buyer.account.address]);
    const sellerMargin2 = await futures.read.getMinMargin([seller.account.address]);
    assert.ok(buyerMargin2 < buyerMargin);
    assert.ok(sellerMargin2 > sellerMargin);
  });

  it("effective margin can go negative for expensive sell", async () => {
    const { contracts } = await positionWithMarginFixture();
    const { futures, collateralVault } = contracts;

    const marketPricePerDay = await futures.read.getMarketPrice();

    const buyerMargin = await futures.read.getMinMarginForPosition([marketPricePerDay * 100n, -1n]);
    assert.ok(buyerMargin < 0n);
  });

  it("orders with positive effective margin should be considered for effective margin", async () => {
    const { contracts, accounts, deliveryDate } = await positionWithMarginFixture();
    const { futures, collateralVault } = contracts;
    const { buyer } = accounts;

    const marketPricePerDay = await futures.read.getMarketPrice();
    await collateralVault.write.deposit([marketPricePerDay * 10n], { account: buyer.account });

    const effectiveMargin = await futures.read.getMinMargin([buyer.account.address]);
    await futures.write.createOrder([marketPricePerDay, deliveryDate, "", -1], {
      account: buyer.account,
    });
    const effectiveMargin2 = await futures.read.getMinMargin([buyer.account.address]);
    assert.ok(effectiveMargin2 > effectiveMargin);
  });

  it("orders with negative effective margin should not be considered for effective margin", async () => {
    const { contracts, accounts, deliveryDate } = await positionWithMarginFixture();
    const { futures, collateralVault } = contracts;
    const { buyer } = accounts;
    const marketPricePerDay = await futures.read.getMarketPrice();
    const effectiveMargin = await futures.read.getMinMargin([buyer.account.address]);
    await futures.write.createOrder([marketPricePerDay * 100n, deliveryDate, "", -1], {
      account: buyer.account,
    });
    const effectiveMargin2 = await futures.read.getMinMargin([buyer.account.address]);
    assert.equal(effectiveMargin2, effectiveMargin);
  });

  it("party cant withdraw more than deposited collateral even if effective margin is negative", async () => {
    const { contracts, accounts, deliveryDate } = await positionWithMarginFixture();
    const { futures, collateralVault } = contracts;
    const { buyer, seller } = accounts;
    const marketPricePerDay = await futures.read.getMarketPrice();

    await futures.write.createOrder([marketPricePerDay * 100n, deliveryDate, "", -1], {
      account: seller.account,
    });

    await collateralVault.write.deposit([marketPricePerDay * 1000n], { account: buyer.account });
    await futures.write.createOrder([marketPricePerDay * 100n, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const effectiveMargin = await futures.read.getMinMargin([seller.account.address]);
    assert.ok(effectiveMargin < 0n);

    const balance = await collateralVault.read.balanceOf([seller.account.address]);
    await viem.assertions.revertWithCustomError(
      collateralVault.write.withdraw([balance + 1n], { account: seller.account }),
      collateralVault,
      "ERC20InsufficientBalance",
    );

    await collateralVault.write.withdraw([balance], { account: seller.account });
  });

  it("outdated orders do not affect getMinMargin calculation", async () => {
    const { contracts, accounts, config } = await positionWithMarginFixture();
    const { futures, collateralVault } = contracts;
    const { buyer, tc, pc } = accounts;
    const marketPricePerDay = await futures.read.getMarketPrice();

    const initialMargin = await futures.read.getMinMargin([buyer.account.address]);

    const futureDeliveryDate = config.deliveryDates[1];
    await collateralVault.write.deposit([marketPricePerDay * 10n], { account: buyer.account });

    const txHash = await futures.write.createOrder([marketPricePerDay, futureDeliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const orderId = events[0].args.orderId;

    const marginWithActiveOrder = await futures.read.getMinMargin([buyer.account.address]);
    assert.ok(marginWithActiveOrder >= initialMargin);

    await tc.setNextBlockTimestamp({ timestamp: futureDeliveryDate + 1n });

    const marginWithOutdatedOrder = await futures.read.getMinMargin([buyer.account.address]);
    assert.ok(marginWithOutdatedOrder <= marginWithActiveOrder);

    const order = await futures.read.getOrderById([orderId]);
    assert.equal(order.participant, getAddress(buyer.account.address));
    assert.equal(order.deliveryAt, futureDeliveryDate);
  });

  it("should calculate minimum margin for orders", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const [date1, date2] = config.deliveryDates;
    const marginAmount = price * BigInt(config.deliveryDurationDays);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });

    await futures.write.createOrder([price, date1, "", 1], { account: seller.account });

    const minMargin = await futures.read.getMinMargin([seller.account.address]);
    assert.ok(minMargin > 0n);

    await futures.write.createOrder([price, date2, "", -1], { account: seller.account });

    const minMarginAfterShort = await futures.read.getMinMargin([seller.account.address]);
    assert.ok(minMarginAfterShort > minMargin);
  });

  it("should calculate minimum margin for positions", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = price * BigInt(config.deliveryDurationDays);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: buyer.account });

    const sellerMinMargin = await futures.read.getMinMargin([seller.account.address]);
    const buyerMinMargin = await futures.read.getMinMargin([buyer.account.address]);

    assert.ok(sellerMinMargin > 0n);
    assert.ok(buyerMinMargin > 0n);
  });
});

describe("Futures - margin management", () => {
  it("should allow adding margin", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, usdcMock, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const sellerBalance1 = await collateralVault.read.balanceOf([seller.account.address]);
    const collateralVaultBalance1 = await usdcMock.read.balanceOf([
      contracts.collateralVault.address,
    ]);

    const marginAmount = parseUnits("1000", 6);

    const txHash = await collateralVault.write.deposit([marginAmount], { account: seller.account });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const sellerBalance2 = await collateralVault.read.balanceOf([seller.account.address]);
    assert.equal(sellerBalance2, sellerBalance1 + marginAmount);

    const collateralVaultBalance2 = await usdcMock.read.balanceOf([
      contracts.collateralVault.address,
    ]);
    assert.equal(collateralVaultBalance2, collateralVaultBalance1 + marginAmount);
  });

  it("should allow removing margin when sufficient balance", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const marginAmount = parseUnits("1000", 6);
    const removeAmount = parseUnits("500", 6);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });

    const txHash = await collateralVault.write.withdraw([removeAmount], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const balance = await collateralVault.read.balanceOf([seller.account.address]);
    assert.equal(balance, marginAmount - removeAmount);
  });

  it("should reject removing margin when insufficient balance", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const marginAmount = parseUnits("1000", 6);
    const removeAmount = parseUnits("1500", 6);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });

    await viem.assertions.revertWithCustomError(
      collateralVault.write.withdraw([removeAmount], { account: seller.account }),
      collateralVault,
      "ERC20InsufficientBalance",
    );
  });
});

describe("Futures - margin call", function () {
  it("should perform margin call when margin is insufficient", async function () {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashrateOracle, collateralVault } = contracts;
    const { seller, validator, pc } = accounts;

    const price = await futures.read.getMarketPrice();
    const minMargin = await futures.read.getMinMarginForPosition([price, 1n]);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([minMargin + config.orderFee], { account: seller.account });

    const tx = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: seller.account,
    });
    const rec = await pc.waitForTransactionReceipt({ hash: tx });
    const [createdEvent] = parseEventLogs({
      logs: rec.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const { orderId } = createdEvent.args;

    // Halve the hashprice so the buy order is now collateral-deficient (equivalent
    // to halving BTC price in the legacy oracle setup).
    await scaleHashprice(hashrateOracle, 1n, 2n);

    const txHash = await futures.write.marginCall([seller.account.address], {
      account: validator.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const [closedEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    assert.equal(closedEvent.args.orderId, orderId);

    const order = await futures.read.getOrderById([orderId]);
    assert.equal(order.participant, zeroAddress);
  });

  it("should reject margin call by non-validator", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    await viem.assertions.revertWithCustomError(
      futures.write.marginCall([seller.account.address], { account: seller.account }),
      futures,
      "OnlyValidator",
    );
  });
});
