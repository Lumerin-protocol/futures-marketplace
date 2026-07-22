import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";

const { networkHelpers } = await network.getOrCreate();

async function totalContractBalance(contracts: FuturesFixture["contracts"]) {
  const { futures, collateralVault } = contracts;
  const insuranceFundAddr = await collateralVault.read.INSURANCE_FUND_ADDR();
  return (
    (await collateralVault.read.balanceOf([futures.address])) +
    (await collateralVault.read.balanceOf([insuranceFundAddr]))
  );
}

describe("Futures - createOrder - Order Matching and Position Creation", () => {
  it("should match sell and buy orders and create a position", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -2n], { account: seller.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, 2n], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });

    assert.equal(events.length, 1);
    const match = events[0];
    assert.equal(getAddress(match.args.maker), getAddress(seller.account.address));
    assert.equal(getAddress(match.args.taker), getAddress(buyer.account.address));
    assert.equal(match.args.tradePrice, price);
    assert.equal(match.args.expirationAt, BigInt(deliveryDate));
    assert.equal(match.args.takerQuantity, 2n);
    assert.equal(match.args.makerNetQtyAfter, -2n);
    assert.equal(match.args.takerNetQtyAfter, 2n);

    const buyerPos = await futures.read.getUserPosition([buyer.account.address, deliveryDate]);
    const sellerPos = await futures.read.getUserPosition([seller.account.address, deliveryDate]);
    assert.equal(buyerPos.netQuantity, 2n);
    assert.equal(sellerPos.netQuantity, -2n);
  });

  it("should match buy and sell orders and create a position", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: buyer.account });
    await collateralVault.write.deposit([margin], { account: seller.account });

    await futures.write.createOrder([price, deliveryDate, 2n], { account: buyer.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, -2n], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });

    assert.equal(events.length, 1);
    const match = events[0];
    assert.equal(getAddress(match.args.maker), getAddress(buyer.account.address));
    assert.equal(getAddress(match.args.taker), getAddress(seller.account.address));
    assert.equal(match.args.tradePrice, price);
    assert.equal(match.args.expirationAt, BigInt(deliveryDate));
    assert.equal(match.args.takerQuantity, -2n);

    const buyerPos = await futures.read.getUserPosition([buyer.account.address, deliveryDate]);
    const sellerPos = await futures.read.getUserPosition([seller.account.address, deliveryDate]);
    assert.equal(buyerPos.netQuantity, 2n);
    assert.equal(sellerPos.netQuantity, -2n);
  });

  it("should exit position when matching order with opposite direction", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller: account1, buyer: account2, buyer2: account3, pc } = accounts;

    const price = parseUnits("100", 6);
    const exitPrice = parseUnits("110", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: account1.account });
    await collateralVault.write.deposit([margin], { account: account2.account });
    await collateralVault.write.deposit([margin], { account: account3.account });

    await futures.write.createOrder([price, deliveryDate, -1n], { account: account1.account });
    await futures.write.createOrder([price, deliveryDate, 1n], { account: account2.account });

    const account2BalanceBefore = await collateralVault.read.balanceOf([account2.account.address]);

    await futures.write.createOrder([exitPrice, deliveryDate, -1n], { account: account2.account });

    const exitTxHash = await futures.write.createOrder([exitPrice, deliveryDate, 1n], {
      account: account3.account,
    });

    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTxHash });
    const matches = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 1);
    assert.equal(getAddress(matches[0].args.maker), getAddress(account2.account.address));
    assert.equal(getAddress(matches[0].args.taker), getAddress(account3.account.address));
    assert.equal(matches[0].args.tradePrice, exitPrice);

    const account2BalanceAfter = await collateralVault.read.balanceOf([account2.account.address]);
    const account2Pos = await futures.read.getUserPosition([account2.account.address, deliveryDate]);
    const account3Pos = await futures.read.getUserPosition([account3.account.address, deliveryDate]);
    const account1Pos = await futures.read.getUserPosition([account1.account.address, deliveryDate]);

    assert.equal(account2Pos.netQuantity, 0n);
    assert.equal(account3Pos.netQuantity, 1n);
    assert.equal(account1Pos.netQuantity, -1n);

    const expectedProfit = exitPrice - price;
    const account2Profit = account2BalanceAfter - account2BalanceBefore;
    // account2 was maker on the exit fill (makerFee defaults to 0).
    assert.equal(account2Profit, expectedProfit);
  });

  it("should exit position with loss and verify accounting is correct", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller: account1, buyer: account2, buyer2: account3, pc } = accounts;

    const price = parseUnits("100", 6);
    const exitPrice = parseUnits("90", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: account1.account });
    await collateralVault.write.deposit([margin], { account: account2.account });
    await collateralVault.write.deposit([margin], { account: account3.account });

    await futures.write.createOrder([price, deliveryDate, -1n], { account: account1.account });
    await futures.write.createOrder([price, deliveryDate, 1n], { account: account2.account });

    const account2BalanceBefore = await collateralVault.read.balanceOf([account2.account.address]);

    await futures.write.createOrder([exitPrice, deliveryDate, -1n], { account: account2.account });

    const contractBalanceBefore = await totalContractBalance(contracts);

    const exitTxHash = await futures.write.createOrder([exitPrice, deliveryDate, 1n], {
      account: account3.account,
    });

    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTxHash });

    const account2BalanceAfter = await collateralVault.read.balanceOf([account2.account.address]);
    const contractBalanceAfter = await totalContractBalance(contracts);

    const matches = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 1);

    assert.equal(
      (await futures.read.getUserPosition([account2.account.address, deliveryDate])).netQuantity,
      0n,
    );

    const expectedLoss = price - exitPrice;
    const account2BalanceChange = account2BalanceAfter - account2BalanceBefore;
    assert.equal(account2BalanceChange, -expectedLoss);

    const takerFee = await futures.read.takerFee();
    assert.equal(contractBalanceAfter - contractBalanceBefore, expectedLoss + takerFee);
  });

  it("should handle exiting positions", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await collateralVault.write.deposit([margin], { account: buyer2.account });

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 1n], { account: buyer.account });

    const newPrice = price * 2n;
    const createOrderTxHash = await futures.write.createOrder([newPrice, deliveryDate, -1n], {
      account: buyer.account,
    });
    const createOrderReceipt = await pc.waitForTransactionReceipt({ hash: createOrderTxHash });
    const [exitOrderCreated] = parseEventLogs({
      logs: createOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    const txHash2 = await futures.write.createOrder([newPrice, deliveryDate, 1n], {
      account: buyer2.account,
    });

    const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });
    const [match] = parseEventLogs({
      logs: receipt2.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });

    assert.equal(match.args.makerOrderId, exitOrderCreated.args.orderId);
    assert.equal(getAddress(match.args.maker), getAddress(buyer.account.address));
    assert.equal(getAddress(match.args.taker), getAddress(buyer2.account.address));
    assert.equal(match.args.tradePrice, newPrice);
    assert.equal(match.args.makerNetQtyAfter, 0n);
    assert.equal(match.args.takerNetQtyAfter, 1n);

    assert.equal(
      (await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity,
      0n,
    );
    assert.equal(
      (await futures.read.getUserPosition([buyer2.account.address, deliveryDate])).netQuantity,
      1n,
    );
    assert.equal(
      (await futures.read.getUserPosition([seller.account.address, deliveryDate])).netQuantity,
      -1n,
    );

    const pnl = newPrice - price;
    const takerFee = await futures.read.takerFee();
    const buyerBalanceDelta =
      (await collateralVault.read.balanceOf([buyer.account.address])) - margin;
    // Buyer paid takerFee on the initial entry fill; exit was maker-side (no fee).
    assert.equal(buyerBalanceDelta, pnl - takerFee);
  });

  it("emits OrderCreated and OrderUpdated(qty=0) for the taker on an immediate fill", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    const restTxHash = await futures.write.createOrder([price, deliveryDate, -1n], {
      account: seller.account,
    });
    const restReceipt = await pc.waitForTransactionReceipt({ hash: restTxHash });
    const [makerCreated] = parseEventLogs({
      logs: restReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(getAddress(makerCreated.args.participant), getAddress(seller.account.address));

    const takeTxHash = await futures.write.createOrder([price, deliveryDate, 1n], {
      account: buyer.account,
    });
    const takeReceipt = await pc.waitForTransactionReceipt({ hash: takeTxHash });

    const ordersCreated = parseEventLogs({
      logs: takeReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const ordersUpdated = parseEventLogs({
      logs: takeReceipt.logs,
      abi: futures.abi,
      eventName: "OrderUpdated",
    });
    const [match] = parseEventLogs({
      logs: takeReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });

    assert.equal(ordersCreated.length, 1);
    assert.equal(ordersUpdated.length, 2);

    const takerOrderCreated = ordersCreated[0];
    assert.equal(getAddress(takerOrderCreated.args.participant), getAddress(buyer.account.address));
    assert.equal(takerOrderCreated.args.price, price);
    assert.equal(takerOrderCreated.args.expirationAt, BigInt(deliveryDate));
    assert.equal(takerOrderCreated.args.quantity, 1n);

    const updatedByOrderId = new Map(ordersUpdated.map((e) => [e.args.orderId, e.args.newQuantity]));
    assert.equal(updatedByOrderId.get(takerOrderCreated.args.orderId), 0n);
    assert.equal(updatedByOrderId.get(makerCreated.args.orderId), 0n);

    assert.equal(match.args.makerOrderId, makerCreated.args.orderId);
    assert.equal(getAddress(match.args.maker), getAddress(seller.account.address));
    assert.equal(getAddress(match.args.taker), getAddress(buyer.account.address));
    assert.notEqual(match.args.makerOrderId, takerOrderCreated.args.orderId);

    assert.equal(
      (await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity,
      1n,
    );
    assert.equal(
      (await futures.read.getUserPosition([seller.account.address, deliveryDate])).netQuantity,
      -1n,
    );
  });
});
