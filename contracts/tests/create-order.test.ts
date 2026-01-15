import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { parseEventLogs, parseUnits, getAddress, zeroAddress } from "viem";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";
import { catchError } from "../../lib";

describe("Order Creation", function () {
  it("should validate delivery date is in the future", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const currentTime = BigInt(await time.latest());
    const pastDate = currentTime - 86400n;

    await catchError(futures.abi, "DeliveryDateShouldBeInTheFuture", async () => {
      await futures.write.createOrder([price, pastDate, "", 1], {
        account: seller.account,
      });
    });
  });

  it("should validate delivery date is not before first future delivery date", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const firstFutureDeliveryDate = await futures.read.firstFutureDeliveryDate();
    const dateBeforeFirst = firstFutureDeliveryDate - 86400n;

    await catchError(futures.abi, "DeliveryDateNotAvailable", async () => {
      await futures.write.createOrder([price, dateBeforeFirst, "", 1], {
        account: seller.account,
      });
    });
  });

  it("should validate delivery date is aligned with delivery interval", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const firstFutureDeliveryDate = await futures.read.firstFutureDeliveryDate();
    const deliveryIntervalDays = await futures.read.deliveryIntervalDays();
    const deliveryIntervalSeconds = BigInt(deliveryIntervalDays) * 86400n;

    // Try a date that is not aligned with the interval
    const misalignedDate = firstFutureDeliveryDate + deliveryIntervalSeconds / 2n;

    await catchError(futures.abi, "DeliveryDateNotAvailable", async () => {
      await futures.write.createOrder([price, misalignedDate, "", 1], {
        account: seller.account,
      });
    });
  });

  it("should validate delivery date is within available range", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const deliveryDates = await futures.read.getDeliveryDates();
    const lastAvailableDate = deliveryDates[deliveryDates.length - 1];
    const deliveryIntervalDays = await futures.read.deliveryIntervalDays();
    const deliveryIntervalSeconds = BigInt(deliveryIntervalDays) * 86400n;

    // Try a date beyond the available range
    const dateBeyondRange = lastAvailableDate + deliveryIntervalSeconds;

    await catchError(futures.abi, "DeliveryDateNotAvailable", async () => {
      await futures.write.createOrder([price, dateBeyondRange, "", 1], {
        account: seller.account,
      });
    });
  });

  it("should accept valid delivery dates from getDeliveryDates", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);

    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Try creating orders for all available delivery dates
    for (const deliveryDate of config.deliveryDates) {
      const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
        account: seller.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      expect(receipt.status).to.equal("success");

      const events = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });

      expect(events.length).to.be.greaterThan(0);
      expect(events[0].args.deliveryAt).to.equal(deliveryDate);
    }
  });

  it("should create a buy order when no matching sell order exists", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const qty = 5;
    const price = await futures.read.getMarketPrice();
    const margin = await futures.read.getMinMarginForPosition([price, BigInt(qty)]);
    const deliveryDate = BigInt(config.deliveryDates[0]);

    await futures.write.addMargin([margin + config.orderFee], {
      account: seller.account,
    });

    const txHash = await futures.write.createOrder([price, deliveryDate, "", qty], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    expect(events.length).to.equal(5);

    for (const event of events) {
      expect(event.args.orderId).to.not.be.undefined;
      expect(getAddress(event.args.participant)).to.equal(getAddress(seller.account.address));
      expect(event.args.pricePerDay).to.equal(price);
      expect(event.args.deliveryAt).to.equal(deliveryDate);
      expect(event.args.isBuy).to.equal(true);
    }
  });

  it("should create a sell order when no matching buy order exists", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { seller, pc } = accounts;
    const { futures } = contracts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const qty = -5;

    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    const txHash = await futures.write.createOrder([price, deliveryDate, "", qty], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    expect(events.length).to.equal(5);

    for (const event of events) {
      expect(event.args.orderId).to.not.be.undefined;
      expect(getAddress(event.args.participant)).to.equal(getAddress(seller.account.address));
      expect(event.args.pricePerDay).to.equal(price);
      expect(event.args.deliveryAt).to.equal(BigInt(deliveryDate));
      expect(event.args.isBuy).to.equal(false);
    }
  });

  it("should collect order fee, when order is created or matched, but not when it is offsetted (closed)", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Add margin first
    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Get initial balances
    const initialSellerBalance = await futures.read.balanceOf([seller.account.address]);
    const initialContractBalance = await futures.read.balanceOf([futures.address]);

    // Create order - this should collect the order fee
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 5], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).to.equal("success");

    // Verify order fee was deducted from seller's balance
    const finalSellerBalance = await futures.read.balanceOf([seller.account.address]);
    expect(finalSellerBalance).to.equal(initialSellerBalance - config.orderFee);

    // Verify order fee was added to contract's reserve pool balance
    const finalContractBalance = await futures.read.balanceOf([futures.address]);
    expect(finalContractBalance).to.equal(initialContractBalance + config.orderFee);

    // Create a sell order with opposite direction (same price and delivery date)
    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", -5], {
      account: seller.account,
    });

    const sellOrderReceipt = await pc.waitForTransactionReceipt({ hash: sellOrderTxHash });
    expect(sellOrderReceipt.status).to.equal("success");

    // Verify order fee was not deducted from seller's balance
    const finalSellerBalance2 = await futures.read.balanceOf([seller.account.address]);
    expect(finalSellerBalance2).to.equal(finalSellerBalance);

    // Verify order fee was not added to contract's reserve pool balance
    const finalContractBalance2 = await futures.read.balanceOf([futures.address]);
    expect(finalContractBalance2).to.equal(finalContractBalance);
  });

  it("should reject order creation with zero price", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = 0n;
    const deliveryDate = config.deliveryDates[0];

    await catchError(futures.abi, "InvalidPrice", async () => {
      await futures.write.createOrder([price, deliveryDate, "", 1], {
        account: seller.account,
      });
    });
  });

  it("should reject order creation with price not divisible by price ladder step", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6) + config.priceLadderStep / 2n;
    const deliveryDate = config.deliveryDates[0];

    await catchError(futures.abi, "InvalidPrice", async () => {
      await futures.write.createOrder([price, deliveryDate, "", 1], {
        account: seller.account,
      });
    });
  });

  it("should reject order creation with past delivery date", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const currentTime = BigInt(await time.latest());
    const pastDate = currentTime - 86400n;

    await catchError(futures.abi, "DeliveryDateShouldBeInTheFuture", async () => {
      await futures.write.createOrder([price, pastDate, "", 1], {
        account: seller.account,
      });
    });
  });

  it("should reject order creation with insufficient margin balance", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];

    // Don't add any margin - balance should be 0
    const balance = await futures.read.balanceOf([seller.account.address]);
    expect(balance).to.equal(0n);

    const deficit = await futures.read.getCollateralDeficit([seller.account.address]);
    expect(deficit).to.be.equal(0n);

    // we need to add order fee to the margin balance, so we can create an order
    await futures.write.addMargin([config.orderFee], {
      account: seller.account,
    });

    await catchError(futures.abi, "InsufficientMarginBalance", async () => {
      await futures.write.createOrder([price, deliveryDate, "", 1], {
        account: seller.account,
      });
    });
  });

  it("should allow order creation with sufficient margin balance", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Add sufficient margin (required margin + some extra)
    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Create order should succeed
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).to.equal("success");

    // Verify order was created
    const [event] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    expect(event.args.orderId).to.not.be.undefined;
    expect(getAddress(event.args.participant)).to.equal(getAddress(seller.account.address));
    expect(event.args.pricePerDay).to.equal(price);
    expect(event.args.deliveryAt).to.equal(deliveryDate);
    expect(event.args.isBuy).to.equal(true);
  });

  it("should allow position creation when margin balance equals exactly required margin", async function () {});

  it("should reject sell order creation with insufficient margin balance", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];

    // The margin balance should be exactly the order fee
    await futures.write.addMargin([config.orderFee], {
      account: seller.account,
    });
    const balance = await futures.read.balanceOf([seller.account.address]);
    expect(balance).to.equal(config.orderFee);

    await catchError(futures.abi, "InsufficientMarginBalance", async () => {
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
    });
  });

  it("should allow sell order creation with sufficient margin balance", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const isBuy = false; // Short position

    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Create position should succeed
    const txHash = await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).to.equal("success");

    // Verify position was created
    const [event] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    expect(event.args.orderId).to.not.be.undefined;
    expect(getAddress(event.args.participant)).to.equal(getAddress(seller.account.address));
    expect(event.args.pricePerDay).to.equal(price);
    expect(event.args.deliveryAt).to.equal(deliveryDate);
    expect(event.args.isBuy).to.equal(isBuy);
  });

  it("should remove existing order when creating one with opposite direction", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Add margin first
    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Create a buy order
    const buyOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: seller.account,
    });

    const buyOrderReceipt = await pc.waitForTransactionReceipt({ hash: buyOrderTxHash });
    expect(buyOrderReceipt.status).to.equal("success");

    // Get the order ID from the OrderCreated event
    const [buyOrderCreatedEvent] = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    const buyOrderId = buyOrderCreatedEvent.args.orderId;

    // Create a sell order with opposite direction (same price and delivery date)
    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });

    const sellOrderReceipt = await pc.waitForTransactionReceipt({ hash: sellOrderTxHash });
    expect(sellOrderReceipt.status).to.equal("success");

    // Verify OrderClosed event was emitted for the original buy order
    const [orderClosedEvent] = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });

    expect(orderClosedEvent.args.orderId).to.equal(buyOrderId);
    expect(getAddress(orderClosedEvent.args.participant)).to.equal(
      getAddress(seller.account.address)
    );

    // Verify no new OrderCreated event was emitted (since it just closes and returns)
    const newOrderCreatedEvents = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    expect(newOrderCreatedEvents.length).to.equal(0);

    // Verify the original order no longer exists
    const closedOrder = await futures.read.getOrderById([buyOrderId]);
    expect(closedOrder.participant).to.equal(zeroAddress);
  });

  it("should partially remove existing orders when creating opposite direction orders", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Add margin first
    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Create 3 sell orders
    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", -3], {
      account: seller.account,
    });

    const sellOrderReceipt = await pc.waitForTransactionReceipt({ hash: sellOrderTxHash });
    expect(sellOrderReceipt.status).to.equal("success");

    // Get all 3 sell order IDs from OrderCreated events
    const sellOrderCreatedEvents = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    expect(sellOrderCreatedEvents.length).to.equal(3);
    const sellOrderIds = sellOrderCreatedEvents.map((event) => event.args.orderId);

    // Create 2 buy orders with opposite direction (same price and delivery date)
    const buyOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", 2], {
      account: seller.account,
    });

    const buyOrderReceipt = await pc.waitForTransactionReceipt({ hash: buyOrderTxHash });
    expect(buyOrderReceipt.status).to.equal("success");

    // Verify 2 OrderClosed events were emitted for the sell orders
    const orderClosedEvents = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });

    expect(orderClosedEvents.length).to.equal(2);

    // Verify the closed orders are from our sell order IDs
    const closedOrderIds = orderClosedEvents.map((event) => event.args.orderId);
    for (const closedOrderId of closedOrderIds) {
      expect(sellOrderIds).to.include(closedOrderId);
      expect(
        getAddress(
          orderClosedEvents.find((e) => e.args.orderId === closedOrderId)!.args.participant
        )
      ).to.equal(getAddress(seller.account.address));
    }

    // Verify no new OrderCreated events were emitted (since it just closes existing orders)
    const newOrderCreatedEvents = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    expect(newOrderCreatedEvents.length).to.equal(0);

    // Verify 2 sell orders were closed (participant is zeroAddress)
    for (const closedOrderId of closedOrderIds) {
      const closedOrder = await futures.read.getOrderById([closedOrderId]);
      expect(closedOrder.participant).to.equal(zeroAddress);
    }

    // Verify 1 sell order remains (find the one that wasn't closed)
    const remainingSellOrderId = sellOrderIds.find((id) => !closedOrderIds.includes(id))!;
    const remainingOrder = await futures.read.getOrderById([remainingSellOrderId]);
    expect(getAddress(remainingOrder.participant)).to.equal(getAddress(seller.account.address));
    expect(remainingOrder.isBuy).to.equal(false);
    expect(remainingOrder.pricePerDay).to.equal(price);
    expect(remainingOrder.deliveryAt).to.equal(deliveryDate);
  });

  it("should remove existing orders when creating an opposite order even if margin balance is insufficient", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];

    const minMarginForOneOrder = await futures.read.getMinMarginForPosition([price, -1n]);

    // Add just enough margin for one order plus the order fee
    const orderFee = await futures.read.orderFee();
    const margin = minMarginForOneOrder + orderFee * 2n; // enough for one order + fees for both operations

    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Create a buy order - this should use most of the margin
    await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: seller.account,
    });

    // Check that margin is now mostly used
    const collateralDeficit = await futures.read.getCollateralDeficit([seller.account.address]);
    // collateralDeficit should be close to 0 or positive (meaning we're near or at margin limit)
    console.log("Collateral deficit after buy order:", collateralDeficit);

    // Now try to create a sell order with the same price and delivery date
    // This should close the existing buy order, but currently fails due to insufficient margin check
    // happening before the order closing logic
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
  });

  it("should automatically remove outdated orders when creating a new order", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc, tc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const oldDeliveryDate = config.deliveryDates[0];
    const newDeliveryDate = config.deliveryDates[1];

    // Add margin first
    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Create an order with an old delivery date
    const oldOrderTxHash = await futures.write.createOrder([price, oldDeliveryDate, "", 1], {
      account: seller.account,
    });

    const oldOrderReceipt = await pc.waitForTransactionReceipt({ hash: oldOrderTxHash });
    const oldOrderEvents = parseEventLogs({
      logs: oldOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const oldOrderId = oldOrderEvents[0].args.orderId;

    // Verify the old order exists
    let oldOrder = await futures.read.getOrderById([oldOrderId]);
    expect(getAddress(oldOrder.participant)).to.equal(getAddress(seller.account.address));
    expect(oldOrder.deliveryAt).to.equal(oldDeliveryDate);

    // Advance time past the old delivery date to make it outdated
    await tc.setNextBlockTimestamp({ timestamp: oldDeliveryDate + 1n });

    // Create a new order - this should automatically remove the outdated order
    const newOrderTxHash = await futures.write.createOrder([price, newDeliveryDate, "", 1], {
      account: seller.account,
    });

    const newOrderReceipt = await pc.waitForTransactionReceipt({ hash: newOrderTxHash });

    // Verify OrderClosed event was emitted for the outdated order
    const orderClosedEvents = parseEventLogs({
      logs: newOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });

    expect(orderClosedEvents.length).to.equal(1);
    expect(orderClosedEvents[0].args.orderId).to.equal(oldOrderId);
    expect(getAddress(orderClosedEvents[0].args.participant)).to.equal(
      getAddress(seller.account.address)
    );

    // Verify the old order no longer exists (participant is zeroAddress)
    oldOrder = await futures.read.getOrderById([oldOrderId]);
    expect(oldOrder.participant).to.equal(zeroAddress);

    // Verify the new order was created
    const newOrderEvents = parseEventLogs({
      logs: newOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    expect(newOrderEvents.length).to.equal(1);
    expect(newOrderEvents[0].args.deliveryAt).to.equal(newDeliveryDate);
  });

  it("should enforce maximum orders per participant", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const numOrders = await futures.read.MAX_ORDERS_PER_PARTICIPANT();
    const price = await futures.read.getMarketPrice();
    const margin = price * BigInt(config.deliveryDurationDays) * BigInt(numOrders);
    const deliveryDate = config.deliveryDates[0];

    // Add margin
    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    // Create maximum number of positions (50)
    for (let i = 0; i < numOrders; i++) {
      await futures.write.createOrder(
        [price + BigInt(i) * config.priceLadderStep, deliveryDate, "", 1],
        { account: seller.account }
      );
    }

    // Try to create one more position
    await catchError(futures.abi, "MaxOrdersPerParticipantReached", async () => {
      await futures.write.createOrder([price + 50n * config.priceLadderStep, deliveryDate, "", 1], {
        account: seller.account,
      });
    });
  });
});
