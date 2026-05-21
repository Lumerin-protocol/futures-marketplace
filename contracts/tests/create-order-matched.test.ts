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

    await futures.write.createOrder([price, deliveryDate, "", -2], { account: seller.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, "", 2], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });

    assert.equal(events.length, 2);
    for (const orderEvent of events) {
      assert.equal(getAddress(orderEvent.args.seller), getAddress(seller.account.address));
      assert.equal(getAddress(orderEvent.args.buyer), getAddress(buyer.account.address));
      assert.equal(orderEvent.args.pricePerDay, price);
      assert.equal(orderEvent.args.deliveryAt, BigInt(deliveryDate));
    }
  });

  it("should match sell and buy orders and create an position", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: buyer.account });
    await collateralVault.write.deposit([margin], { account: seller.account });

    await futures.write.createOrder([price, deliveryDate, "", 2], { account: buyer.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, "", -2], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });

    assert.equal(events.length, 2);
    for (const event of events) {
      assert.equal(getAddress(event.args.seller), getAddress(seller.account.address));
      assert.equal(getAddress(event.args.buyer), getAddress(buyer.account.address));
      assert.equal(event.args.pricePerDay, price);
      assert.equal(event.args.deliveryAt, BigInt(deliveryDate));
    }
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

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: account1.account });
    const initialTxHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: account2.account,
    });

    const initialReceipt = await pc.waitForTransactionReceipt({ hash: initialTxHash });
    const [initialPositionCreatedEvent] = parseEventLogs({
      logs: initialReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });

    const initialPositionId = initialPositionCreatedEvent.args.lotId;
    assert.equal(
      getAddress(initialPositionCreatedEvent.args.seller),
      getAddress(account1.account.address),
    );
    assert.equal(
      getAddress(initialPositionCreatedEvent.args.buyer),
      getAddress(account2.account.address),
    );

    const account2BalanceBefore = await collateralVault.read.balanceOf([account2.account.address]);

    await futures.write.createOrder([exitPrice, deliveryDate, "", -1], {
      account: account2.account,
    });

    const exitTxHash = await futures.write.createOrder([exitPrice, deliveryDate, "", 1], {
      account: account3.account,
    });

    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTxHash });

    const account2BalanceAfter = await collateralVault.read.balanceOf([account2.account.address]);

    const [lotTransferredEvent] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "LotTransferred",
    });

    assert.equal(lotTransferredEvent.args.oldLotId, initialPositionId);
    assert.equal(
      getAddress(lotTransferredEvent.args.exitingParticipant),
      getAddress(account2.account.address),
    );
    assert.equal(
      getAddress(lotTransferredEvent.args.newParticipant),
      getAddress(account3.account.address),
    );
    assert.equal(lotTransferredEvent.args.newPricePerDay, exitPrice);

    const deliveryDurationDays = await futures.read.deliveryDurationDays();
    const expectedProfit = (exitPrice - price) * BigInt(deliveryDurationDays);
    const account2Profit = account2BalanceAfter - account2BalanceBefore;

    const orderFee = await futures.read.orderFee();
    assert.equal(account2Profit + orderFee, expectedProfit);
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

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: account1.account });
    const initialTxHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: account2.account,
    });

    const initialReceipt = await pc.waitForTransactionReceipt({ hash: initialTxHash });
    const [initialPositionCreatedEvent] = parseEventLogs({
      logs: initialReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });

    const initialPositionId = initialPositionCreatedEvent.args.lotId;
    assert.equal(
      getAddress(initialPositionCreatedEvent.args.seller),
      getAddress(account1.account.address),
    );
    assert.equal(
      getAddress(initialPositionCreatedEvent.args.buyer),
      getAddress(account2.account.address),
    );

    const account2BalanceBefore = await collateralVault.read.balanceOf([account2.account.address]);

    await futures.write.createOrder([exitPrice, deliveryDate, "", -1], {
      account: account2.account,
    });

    const contractBalanceBefore = await totalContractBalance(contracts);

    const exitTxHash = await futures.write.createOrder([exitPrice, deliveryDate, "", 1], {
      account: account3.account,
    });

    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTxHash });

    const account2BalanceAfter = await collateralVault.read.balanceOf([account2.account.address]);
    const contractBalanceAfter = await totalContractBalance(contracts);

    const [lotTransferredEvent] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "LotTransferred",
    });

    assert.equal(lotTransferredEvent.args.oldLotId, initialPositionId);
    assert.equal(
      getAddress(lotTransferredEvent.args.exitingParticipant),
      getAddress(account2.account.address),
    );
    assert.equal(
      getAddress(lotTransferredEvent.args.newParticipant),
      getAddress(account3.account.address),
    );
    assert.equal(lotTransferredEvent.args.newPricePerDay, exitPrice);

    const deliveryDurationDays = await futures.read.deliveryDurationDays();
    const expectedLoss = (price - exitPrice) * BigInt(deliveryDurationDays);
    const account2BalanceChange = account2BalanceAfter - account2BalanceBefore;

    const orderFee = await futures.read.orderFee();
    assert.equal(account2BalanceChange, -expectedLoss - orderFee);

    // account2's exit order fee already in `contractBalanceBefore`, so only account3's fee is new.
    const expectedContractBalanceChange = expectedLoss + orderFee;
    assert.equal(contractBalanceAfter - contractBalanceBefore, expectedContractBalanceChange);
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

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [createdEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });

    const newPrice = price * 2n;
    const createOrderTxHash = await futures.write.createOrder([newPrice, deliveryDate, "", -1], {
      account: buyer.account,
    });
    const createOrderReceipt = await pc.waitForTransactionReceipt({ hash: createOrderTxHash });
    const [order2CreatedEvent] = parseEventLogs({
      logs: createOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const txHash2 = await futures.write.createOrder([newPrice, deliveryDate, "", 1], {
      account: buyer2.account,
    });

    const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });

    const [lotTransferredEvent] = parseEventLogs({
      logs: receipt2.logs,
      abi: futures.abi,
      eventName: "LotTransferred",
    });
    assert.equal(lotTransferredEvent.args.oldLotId, createdEvent.args.lotId);
    assert.equal(
      getAddress(lotTransferredEvent.args.exitingParticipant),
      getAddress(buyer.account.address),
    );
    assert.equal(
      getAddress(lotTransferredEvent.args.newParticipant),
      getAddress(buyer2.account.address),
    );
    assert.equal(lotTransferredEvent.args.newPricePerDay, newPrice);
    assert.equal(lotTransferredEvent.args.makerOrderId, order2CreatedEvent.args.orderId);

    const pnl = (newPrice - price) * BigInt(config.deliveryDurationDays);
    assert.equal(lotTransferredEvent.args.exitPnl, pnl);
  });

  it("emits a paired OrderCreated+OrderClosed for the taker on an immediate fill", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    // Maker rests a sell order — emits a single OrderCreated for the maker.
    const restTxHash = await futures.write.createOrder([price, deliveryDate, "u-maker", -1], {
      account: seller.account,
    });
    const restReceipt = await pc.waitForTransactionReceipt({ hash: restTxHash });
    const [makerCreated] = parseEventLogs({
      logs: restReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(getAddress(makerCreated.args.participant), getAddress(seller.account.address));

    // Taker places the opposing buy order — fills immediately.
    const takeTxHash = await futures.write.createOrder([price, deliveryDate, "u-taker", 1], {
      account: buyer.account,
    });
    const takeReceipt = await pc.waitForTransactionReceipt({ hash: takeTxHash });

    // The taker tx emits exactly one OrderCreated (for the taker), and two OrderCloseds
    // (one for the taker, one for the maker that just got matched).
    const ordersCreated = parseEventLogs({
      logs: takeReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const ordersClosed = parseEventLogs({
      logs: takeReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    const [positionCreated] = parseEventLogs({
      logs: takeReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });

    assert.equal(ordersCreated.length, 1);
    assert.equal(ordersClosed.length, 2);

    const takerOrderCreated = ordersCreated[0];
    assert.equal(getAddress(takerOrderCreated.args.participant), getAddress(buyer.account.address));
    assert.equal(takerOrderCreated.args.destURL, "u-taker");
    assert.equal(takerOrderCreated.args.pricePerDay, price);
    assert.equal(takerOrderCreated.args.deliveryAt, BigInt(deliveryDate));
    assert.equal(takerOrderCreated.args.isBuy, true);

    // Both OrderCloseds should reference the taker (its own match-cancel) and the maker.
    const closedIds = new Set(ordersClosed.map((e) => e.args.orderId));
    assert.equal(closedIds.has(takerOrderCreated.args.orderId), true);
    assert.equal(closedIds.has(makerCreated.args.orderId), true);

    // LotCreated wires both order ids together.
    assert.equal(positionCreated.args.makerOrderId, makerCreated.args.orderId);
    assert.equal(positionCreated.args.takerOrderId, takerOrderCreated.args.orderId);
    assert.notEqual(positionCreated.args.makerOrderId, positionCreated.args.takerOrderId);
  });
});
