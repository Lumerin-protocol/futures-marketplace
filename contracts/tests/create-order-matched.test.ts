import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { parseEventLogs, parseUnits, getAddress } from "viem";
import { deployFuturesFixture } from "./fixtures";

describe("Futures - createOrder - Order Matching and Position Creation", function () {
  it("should match sell and buy orders and create a position", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await futures.write.addMargin([margin], {
      account: seller.account,
    });
    await futures.write.addMargin([margin], {
      account: buyer.account,
    });

    // Create sell order first
    await futures.write.createOrder([price, deliveryDate, "", -2], {
      account: seller.account,
    });

    // Create matching long order
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 2], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    expect(events.length).to.equal(2);
    for (const orderEvent of events) {
      expect(getAddress(orderEvent.args.seller)).to.equal(getAddress(seller.account.address));
      expect(getAddress(orderEvent.args.buyer)).to.equal(getAddress(buyer.account.address));
      expect(orderEvent.args.sellPricePerDay).to.equal(price);
      expect(orderEvent.args.buyPricePerDay).to.equal(price);
      expect(orderEvent.args.deliveryAt).to.equal(BigInt(deliveryDate));
    }
  });

  it("should match sell and buy orders and create an position", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await futures.write.addMargin([margin], {
      account: buyer.account,
    });

    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Create buy order first
    await futures.write.createOrder([price, deliveryDate, "", 2], {
      account: buyer.account,
    });

    // Create matching sell order
    const txHash = await futures.write.createOrder([price, deliveryDate, "", -2], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    expect(events.length).to.equal(2);
    for (const event of events) {
      expect(getAddress(event.args.seller)).to.equal(getAddress(seller.account.address));
      expect(getAddress(event.args.buyer)).to.equal(getAddress(buyer.account.address));
      expect(event.args.sellPricePerDay).to.equal(price);
      expect(event.args.buyPricePerDay).to.equal(price);
      expect(event.args.deliveryAt).to.equal(BigInt(deliveryDate));
    }
  });

  it("should exit position when matching order with opposite direction", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller: account1, buyer: account2, buyer2: account3, pc } = accounts;

    const price = parseUnits("100", 6);
    const exitPrice = parseUnits("110", 6); // Different price for exiting
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Setup margin for all participants
    await futures.write.addMargin([margin], {
      account: account1.account,
    });
    await futures.write.addMargin([margin], {
      account: account2.account,
    });
    await futures.write.addMargin([margin], {
      account: account3.account,
    });

    // Step 1: Create initial position (account1 sells, account2 buys)
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: account1.account,
    });
    const initialTxHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: account2.account,
    });

    const initialReceipt = await pc.waitForTransactionReceipt({ hash: initialTxHash });
    const [initialPositionCreatedEvent] = parseEventLogs({
      logs: initialReceipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const initialPositionId = initialPositionCreatedEvent.args.positionId;
    expect(getAddress(initialPositionCreatedEvent.args.seller)).to.equal(
      getAddress(account1.account.address)
    );
    expect(getAddress(initialPositionCreatedEvent.args.buyer)).to.equal(
      getAddress(account2.account.address)
    );

    // Get account2's balance before exit
    const account2BalanceBefore = await futures.read.balanceOf([account2.account.address]);

    // Step 2: account2 creates a sell order in opposite direction with different price
    // This order will match with account3's buy order, exiting account2's position
    await futures.write.createOrder([exitPrice, deliveryDate, "", -1], {
      account: account2.account,
    });

    // Step 3: account2's sell order matches with account3's buy order, exiting the original position
    const exitTxHash = await futures.write.createOrder([exitPrice, deliveryDate, "", 1], {
      account: account3.account,
    });

    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTxHash });

    // Get account2's balance after exit
    const account2BalanceAfter = await futures.read.balanceOf([account2.account.address]);

    // Verify PositionClosed event for the original position
    const [positionClosedEvent] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "PositionClosed",
    });

    expect(positionClosedEvent.args.positionId).to.equal(initialPositionId);

    // Verify new PositionCreated event (account3 is now the buyer, account1 remains the seller)
    const [newPositionCreatedEvent] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    expect(getAddress(newPositionCreatedEvent.args.seller)).to.equal(
      getAddress(account1.account.address)
    );
    expect(getAddress(newPositionCreatedEvent.args.buyer)).to.equal(
      getAddress(account3.account.address)
    );
    expect(newPositionCreatedEvent.args.sellPricePerDay).to.equal(price);
    expect(newPositionCreatedEvent.args.buyPricePerDay).to.equal(exitPrice);
    expect(newPositionCreatedEvent.args.deliveryAt).to.equal(BigInt(deliveryDate));

    // Verify account2's profit
    // account2 bought at $100/day and sold at $110/day
    // Profit = (exitPrice - price) * deliveryDurationDays
    const deliveryDurationDays = await futures.read.deliveryDurationDays();
    const expectedProfit = (exitPrice - price) * BigInt(deliveryDurationDays);
    const account2Profit = account2BalanceAfter - account2BalanceBefore;

    // Account2 should have made profit equal to the price difference times delivery duration
    // Also account for the order fee that was paid when creating the exit order
    const orderFee = await futures.read.orderFee();
    expect(account2Profit + orderFee).to.equal(expectedProfit);
  });

  it("should exit position with loss and verify accounting is correct", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller: account1, buyer: account2, buyer2: account3, pc } = accounts;

    const price = parseUnits("100", 6);
    const exitPrice = parseUnits("90", 6); // Lower price for exiting (loss scenario)
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Setup margin for all participants
    await futures.write.addMargin([margin], {
      account: account1.account,
    });
    await futures.write.addMargin([margin], {
      account: account2.account,
    });
    await futures.write.addMargin([margin], {
      account: account3.account,
    });

    // Step 1: Create initial position (account1 sells, account2 buys at $100)
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: account1.account,
    });
    const initialTxHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: account2.account,
    });

    const initialReceipt = await pc.waitForTransactionReceipt({ hash: initialTxHash });
    const [initialPositionCreatedEvent] = parseEventLogs({
      logs: initialReceipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const initialPositionId = initialPositionCreatedEvent.args.positionId;
    expect(getAddress(initialPositionCreatedEvent.args.seller)).to.equal(
      getAddress(account1.account.address)
    );
    expect(getAddress(initialPositionCreatedEvent.args.buyer)).to.equal(
      getAddress(account2.account.address)
    );

    // Get account2's balance before exit (after entry order fee)
    const account2BalanceBefore = await futures.read.balanceOf([account2.account.address]);

    // Step 2: account2 creates a sell order in opposite direction with lower price (loss scenario)
    // This order will match with account3's buy order, exiting account2's position
    await futures.write.createOrder([exitPrice, deliveryDate, "", -1], {
      account: account2.account,
    });

    // Get contract balance after account2 creates exit order (includes order fee from exit order)
    const contractBalanceBefore = await futures.read.balanceOf([futures.address]);

    // Step 3: account2's sell order matches with account3's buy order, exiting the original position
    const exitTxHash = await futures.write.createOrder([exitPrice, deliveryDate, "", 1], {
      account: account3.account,
    });

    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTxHash });

    // Get account2's balance after exit
    const account2BalanceAfter = await futures.read.balanceOf([account2.account.address]);
    const contractBalanceAfter = await futures.read.balanceOf([futures.address]);

    // Verify PositionClosed event for the original position
    const [positionClosedEvent] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "PositionClosed",
    });

    expect(positionClosedEvent.args.positionId).to.equal(initialPositionId);

    // Verify new PositionCreated event (account3 is now the buyer, account1 remains the seller)
    const [newPositionCreatedEvent] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    expect(getAddress(newPositionCreatedEvent.args.seller)).to.equal(
      getAddress(account1.account.address)
    );
    expect(getAddress(newPositionCreatedEvent.args.buyer)).to.equal(
      getAddress(account3.account.address)
    );
    expect(newPositionCreatedEvent.args.sellPricePerDay).to.equal(price);
    expect(newPositionCreatedEvent.args.buyPricePerDay).to.equal(exitPrice);
    expect(newPositionCreatedEvent.args.deliveryAt).to.equal(BigInt(deliveryDate));

    // Verify account2's loss
    // account2 bought at $100/day and sold at $90/day
    // Loss = (price - exitPrice) * deliveryDurationDays = (100 - 90) * deliveryDurationDays
    const deliveryDurationDays = await futures.read.deliveryDurationDays();
    const expectedLoss = (price - exitPrice) * BigInt(deliveryDurationDays);
    const account2BalanceChange = account2BalanceAfter - account2BalanceBefore;

    // Account2 should have lost money equal to the price difference times delivery duration
    // Also account for the order fee that was paid when creating the exit order
    const orderFee = await futures.read.orderFee();
    // Balance change = -expectedLoss - orderFee (both negative)
    expect(account2BalanceChange).to.equal(-expectedLoss - orderFee);

    // Verify contract balance increased by the loss amount (account2 paid the contract)
    // Contract receives: loss amount + order fee from account3's buy order
    // Note: account2's exit order fee is already included in contractBalanceBefore
    const expectedContractBalanceChange = expectedLoss + orderFee; // Only account3's order fee is new
    expect(contractBalanceAfter - contractBalanceBefore).to.equal(expectedContractBalanceChange);
  });

  it("should handle exiting positions", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, buyer2, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // setup margin for all participants
    await futures.write.addMargin([margin], { account: seller.account });
    await futures.write.addMargin([margin], { account: buyer.account });
    await futures.write.addMargin([margin], { account: buyer2.account });

    // Create matching orders, to create position
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [createdEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    // create another order, to exit position
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
    // match order by buyer2 thus exiting position for buyer
    const txHash2 = await futures.write.createOrder([newPrice, deliveryDate, "", 1], {
      account: buyer2.account,
    });

    const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });

    // old position closed event
    const [closedEvent] = parseEventLogs({
      logs: receipt2.logs,
      abi: futures.abi,
      eventName: "PositionClosed",
    });
    expect(closedEvent.args.positionId).to.equal(createdEvent.args.positionId);

    // new position created event
    const [createdEvent2] = parseEventLogs({
      logs: receipt2.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });
    expect(createdEvent2.args.seller).to.equal(getAddress(seller.account.address));
    expect(createdEvent2.args.buyer).to.equal(getAddress(buyer2.account.address));
    expect(createdEvent2.args.sellPricePerDay).to.equal(price);
    expect(createdEvent2.args.buyPricePerDay).to.equal(newPrice);
    expect(createdEvent2.args.deliveryAt).to.equal(deliveryDate);
    expect(createdEvent2.args.orderId).to.equal(order2CreatedEvent.args.orderId);

    // realized pnl  event
    const [buyerRealizedProfitEvent] = parseEventLogs({
      logs: receipt2.logs,
      abi: futures.abi,
      eventName: "PositionExited",
      args: { participant: buyer.account.address },
    });

    const pnl = (newPrice - price) * BigInt(config.deliveryDurationDays);
    expect(buyerRealizedProfitEvent.args.pnl).to.equal(pnl);

    // const [buyer2RealizedLossDueToFeeEvent] = parseEventLogs({
    //   logs: receipt2.logs,
    //   abi: futures.abi,
    //   eventName: "PositionExited",
    //   args: { participant: buyer2.account.address },
    // });
    // expect(buyer2RealizedLossDueToFeeEvent.args.pnl).to.equal(-config.orderFee);
  });
});
