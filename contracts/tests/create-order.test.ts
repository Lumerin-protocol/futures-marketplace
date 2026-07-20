import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { warpPastDeliveryWithFreshOracle } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Order Creation", () => {
  it("should validate expiration date is in the future", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const block = await pc.getBlock({ blockTag: "latest" });
    const pastDate = block.timestamp - 86400n;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, pastDate, 1], { account: seller.account }),
      futures,
      "ExpirationDateShouldBeInTheFuture",
    );
  });

  it("should validate expiration date is not before first future expiration date", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const firstFutureExpirationDate = await futures.read.firstFutureExpirationDate();
    const dateBeforeFirst = firstFutureExpirationDate - 86400n;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateBeforeFirst, 1], { account: seller.account }),
      futures,
      "ExpirationDateNotAvailable",
    );
  });

  it("should validate expiration date is aligned with delivery interval", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const firstFutureExpirationDate = await futures.read.firstFutureExpirationDate();
    const expirationIntervalDays = await futures.read.expirationIntervalDays();
    const expirationIntervalSeconds = BigInt(expirationIntervalDays) * 86400n;

    const misalignedDate = firstFutureExpirationDate + expirationIntervalSeconds / 2n;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, misalignedDate, 1], { account: seller.account }),
      futures,
      "ExpirationDateNotAvailable",
    );
  });

  it("should validate expiration date is within available range", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const deliveryDates = await futures.read.getExpirationDates();
    const lastAvailableDate = deliveryDates[deliveryDates.length - 1];
    const expirationIntervalDays = await futures.read.expirationIntervalDays();
    const expirationIntervalSeconds = BigInt(expirationIntervalDays) * 86400n;

    const dateBeyondRange = lastAvailableDate + expirationIntervalSeconds;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateBeyondRange, 1], { account: seller.account }),
      futures,
      "ExpirationDateNotAvailable",
    );
  });

  it("should accept valid expiration dates from getExpirationDates", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });

    for (const deliveryDate of config.deliveryDates) {
      const txHash = await futures.write.createOrder([price, deliveryDate, 1], {
        account: seller.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      assert.equal(receipt.status, "success");

      const events = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });

      assert.ok(events.length > 0);
      assert.equal(events[0].args.expirationAt, deliveryDate);
    }
  });

  it("should create a buy order when no matching sell order exists", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const qty = 5;
    const price = await futures.read.getMarketPrice();
    const margin = price * BigInt(qty);
    const deliveryDate = BigInt(config.deliveryDates[0]);

    await collateralVault.write.deposit([margin], { account: seller.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, qty], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    assert.equal(events.length, 1);
    const event = events[0];
    assert.notEqual(event.args.orderId, undefined);
    assert.equal(getAddress(event.args.participant), getAddress(seller.account.address));
    assert.equal(event.args.price, price);
    assert.equal(event.args.expirationAt, deliveryDate);
    assert.equal(event.args.quantity, BigInt(qty));

    const order = await futures.read.getOrder([event.args.orderId]);
    assert.equal(order.quantity, BigInt(qty));
  });

  it("should create a sell order when no matching buy order exists", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { seller, pc } = accounts;
    const { futures, collateralVault } = contracts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const qty = -5;

    await collateralVault.write.deposit([margin], { account: seller.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, qty], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    assert.equal(events.length, 1);
    const event = events[0];
    assert.notEqual(event.args.orderId, undefined);
    assert.equal(getAddress(event.args.participant), getAddress(seller.account.address));
    assert.equal(event.args.price, price);
    assert.equal(event.args.expirationAt, BigInt(deliveryDate));
    assert.equal(event.args.quantity, BigInt(qty));

    const order = await futures.read.getOrder([event.args.orderId]);
    assert.equal(order.quantity, BigInt(qty));
  });

  it("should not collect maker/taker fees on plain resting orders or on own opposite-side cancels", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const initialSellerBalance = await collateralVault.read.balanceOf([seller.account.address]);
    const initialContractBalance = await collateralVault.read.balanceOf([futures.address]);

    const txHash = await futures.write.createOrder([price, deliveryDate, 5], {
      account: seller.account,
    });
    assert.equal((await pc.waitForTransactionReceipt({ hash: txHash })).status, "success");

    assert.equal(
      await collateralVault.read.balanceOf([seller.account.address]),
      initialSellerBalance,
    );
    assert.equal(await collateralVault.read.balanceOf([futures.address]), initialContractBalance);

    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, -5], {
      account: seller.account,
    });
    assert.equal(
      (await pc.waitForTransactionReceipt({ hash: sellOrderTxHash })).status,
      "success",
    );

    assert.equal(
      await collateralVault.read.balanceOf([seller.account.address]),
      initialSellerBalance,
    );
    assert.equal(await collateralVault.read.balanceOf([futures.address]), initialContractBalance);
  });

  it("should reject order creation with zero price", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const deliveryDate = config.deliveryDates[0];

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([0n, deliveryDate, 1], { account: seller.account }),
      futures,
      "InvalidPrice",
    );
  });

  it("should reject order creation with price not divisible by price ladder step", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6) + config.priceLadderStep / 2n;
    const deliveryDate = config.deliveryDates[0];

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, deliveryDate, 1], { account: seller.account }),
      futures,
      "InvalidPrice",
    );
  });

  it("should reject order creation with past expiration date", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const block = await pc.getBlock({ blockTag: "latest" });
    const pastDate = block.timestamp - 86400n;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, pastDate, 1], { account: seller.account }),
      futures,
      "ExpirationDateShouldBeInTheFuture",
    );
  });

  it("should allow order creation with sufficient margin balance", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, 1], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const [event] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    assert.notEqual(event.args.orderId, undefined);
    assert.equal(getAddress(event.args.participant), getAddress(seller.account.address));
    assert.equal(event.args.price, price);
    assert.equal(event.args.expirationAt, deliveryDate);
    assert.equal(event.args.quantity, 1n);
  });

  it("should allow position creation when margin balance equals exactly required margin", async () => {});

  it("should allow sell order creation with sufficient margin balance", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, -1], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const [event] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    assert.notEqual(event.args.orderId, undefined);
    assert.equal(getAddress(event.args.participant), getAddress(seller.account.address));
    assert.equal(event.args.price, price);
    assert.equal(event.args.expirationAt, deliveryDate);
    assert.equal(event.args.quantity, -1n);
  });

  it("should remove existing order when creating one with opposite direction", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const buyOrderTxHash = await futures.write.createOrder([price, deliveryDate, 1], {
      account: seller.account,
    });

    const buyOrderReceipt = await pc.waitForTransactionReceipt({ hash: buyOrderTxHash });
    assert.equal(buyOrderReceipt.status, "success");

    const [buyOrderCreatedEvent] = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    const buyOrderId = buyOrderCreatedEvent.args.orderId;

    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, -1], {
      account: seller.account,
    });

    const sellOrderReceipt = await pc.waitForTransactionReceipt({ hash: sellOrderTxHash });
    assert.equal(sellOrderReceipt.status, "success");

    const [orderCancelledEvent] = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCancelled",
    });

    assert.equal(orderCancelledEvent.args.orderId, buyOrderId);

    const newOrderCreatedEvents = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(newOrderCreatedEvents.length, 1);

    const takerUpdated = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderUpdated",
    });
    assert.equal(takerUpdated.length, 1);
    assert.equal(takerUpdated[0].args.newQuantity, 0n);

    const closedOrder = await futures.read.getOrder([buyOrderId]);
    assert.equal(closedOrder.quantity, 0n);
  });

  it("should self-cancel a resting order and leave remainder on the book when opposite qty exceeds it", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, -3], {
      account: seller.account,
    });

    const sellOrderReceipt = await pc.waitForTransactionReceipt({ hash: sellOrderTxHash });
    assert.equal(sellOrderReceipt.status, "success");

    const [sellOrderCreated] = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const sellOrderId = sellOrderCreated.args.orderId;

    const buyOrderTxHash = await futures.write.createOrder([price, deliveryDate, 5], {
      account: seller.account,
    });

    const buyOrderReceipt = await pc.waitForTransactionReceipt({ hash: buyOrderTxHash });
    assert.equal(buyOrderReceipt.status, "success");

    const orderCancelledEvents = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCancelled",
    });
    assert.equal(orderCancelledEvents.length, 1);
    assert.equal(orderCancelledEvents[0].args.orderId, sellOrderId);

    const cancelledOrder = await futures.read.getOrder([sellOrderId]);
    assert.equal(cancelledOrder.quantity, 0n);

    const buyOrderCreatedEvents = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(buyOrderCreatedEvents.length, 1);
    assert.equal(buyOrderCreatedEvents[0].args.quantity, 5n);

    const buyOrderUpdated = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderUpdated",
    });
    assert.equal(buyOrderUpdated.length, 1);
    assert.equal(buyOrderUpdated[0].args.newQuantity, 2n);

    const remainingOrder = await futures.read.getOrder([buyOrderCreatedEvents[0].args.orderId]);
    assert.equal(getAddress(remainingOrder.participant), getAddress(seller.account.address));
    assert.equal(remainingOrder.quantity, 2n);
    assert.equal(remainingOrder.price, price);
    assert.equal(remainingOrder.expirationAt, deliveryDate);
  });

  it("should remove existing orders when creating an opposite order even if margin balance is insufficient", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];

    const margin = price;

    await collateralVault.write.deposit([margin], { account: seller.account });

    await futures.write.createOrder([price, deliveryDate, 1], { account: seller.account });

    const sellerAddr = seller.account.address;
    const im = await contracts.portfolioMarginEngine.read.computePortfolioIM([sellerAddr]);
    const balance = await collateralVault.read.balanceOf([sellerAddr]);
    assert.ok(balance > im, "seller has surplus collateral above portfolio IM");

    await futures.write.createOrder([price, deliveryDate, -1], { account: seller.account });
  });

  it("does not auto-sweep expired orders when creating a new order", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc, tc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const oldDeliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const oldOrderTxHash = await futures.write.createOrder([price, oldDeliveryDate, 1], {
      account: seller.account,
    });

    const oldOrderReceipt = await pc.waitForTransactionReceipt({ hash: oldOrderTxHash });
    const oldOrderEvents = parseEventLogs({
      logs: oldOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const oldOrderId = oldOrderEvents[0].args.orderId;

    let oldOrder = await futures.read.getOrder([oldOrderId]);
    assert.equal(getAddress(oldOrder.participant), getAddress(seller.account.address));
    assert.equal(oldOrder.expirationAt, oldDeliveryDate);

    await warpPastDeliveryWithFreshOracle(
      tc,
      contracts.hashrateOracle,
      oldDeliveryDate,
      BigInt(config.expirationIntervalSeconds),
    );
    const futureDates = await futures.read.getExpirationDates();
    const newDeliveryDate = futureDates[futureDates.length - 1];

    const newOrderTxHash = await futures.write.createOrder([price, newDeliveryDate, 1], {
      account: seller.account,
    });

    const newOrderReceipt = await pc.waitForTransactionReceipt({ hash: newOrderTxHash });

    const orderClosedEvents = parseEventLogs({
      logs: newOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCancelled",
    });
    assert.equal(orderClosedEvents.length, 0, "createOrder must not implicitly close expired orders");

    oldOrder = await futures.read.getOrder([oldOrderId]);
    assert.equal(getAddress(oldOrder.participant), getAddress(seller.account.address));

    const newOrderEvents = parseEventLogs({
      logs: newOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(newOrderEvents.length, 1);
    assert.equal(newOrderEvents[0].args.expirationAt, newDeliveryDate);

    const sellerOrders = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(sellerOrders.length, 2, "stale order is still resting next to the new one");
  });

  it("should enforce maximum orders per participant", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const numOrders = await futures.read.MAX_ORDERS_PER_PARTICIPANT();
    const price = await futures.read.getMarketPrice();
    const margin = price * BigInt(numOrders);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    for (let i = 0; i < numOrders; i++) {
      await futures.write.createOrder(
        [price + BigInt(i) * config.priceLadderStep, deliveryDate, 1],
        { account: seller.account },
      );
    }

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price + 50n * config.priceLadderStep, deliveryDate, 1], {
        account: seller.account,
      }),
      futures,
      "MaxOrdersPerParticipantReached",
    );
  });
});
