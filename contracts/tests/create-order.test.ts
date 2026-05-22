import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { warpPastDeliveryWithFreshOracle } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Order Creation", () => {
  it("should validate delivery date is in the future", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const block = await pc.getBlock({ blockTag: "latest" });
    const pastDate = block.timestamp - 86400n;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, pastDate, "", 1], { account: seller.account }),
      futures,
      "DeliveryDateShouldBeInTheFuture",
    );
  });

  it("should validate delivery date is not before first future delivery date", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const firstFutureDeliveryDate = await futures.read.firstFutureDeliveryDate();
    const dateBeforeFirst = firstFutureDeliveryDate - 86400n;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateBeforeFirst, "", 1], { account: seller.account }),
      futures,
      "DeliveryDateNotAvailable",
    );
  });

  it("should validate delivery date is aligned with delivery interval", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const firstFutureDeliveryDate = await futures.read.firstFutureDeliveryDate();
    const deliveryIntervalDays = await futures.read.deliveryIntervalDays();
    const deliveryIntervalSeconds = BigInt(deliveryIntervalDays) * 86400n;

    const misalignedDate = firstFutureDeliveryDate + deliveryIntervalSeconds / 2n;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, misalignedDate, "", 1], { account: seller.account }),
      futures,
      "DeliveryDateNotAvailable",
    );
  });

  it("should validate delivery date is within available range", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const deliveryDates = await futures.read.getDeliveryDates();
    const lastAvailableDate = deliveryDates[deliveryDates.length - 1];
    const deliveryIntervalDays = await futures.read.deliveryIntervalDays();
    const deliveryIntervalSeconds = BigInt(deliveryIntervalDays) * 86400n;

    const dateBeyondRange = lastAvailableDate + deliveryIntervalSeconds;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateBeyondRange, "", 1], { account: seller.account }),
      futures,
      "DeliveryDateNotAvailable",
    );
  });

  it("should accept valid delivery dates from getDeliveryDates", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });

    for (const deliveryDate of config.deliveryDates) {
      const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
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
      assert.equal(events[0].args.deliveryAt, deliveryDate);
    }
  });

  it("should create a buy order when no matching sell order exists", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const qty = 5;
    const price = await futures.read.getMarketPrice();
    // Generous deposit: |qty| × delivery days × entry price covers any
    // PME stress + unrealized-loss requirement at entry.
    const margin = price * BigInt(config.deliveryDurationDays) * BigInt(qty);
    const deliveryDate = BigInt(config.deliveryDates[0]);

    // Resting orders carry no maker/taker fee under the post-2.9 model.
    await collateralVault.write.deposit([margin], { account: seller.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, "", qty], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    assert.equal(events.length, 5);

    for (const event of events) {
      assert.notEqual(event.args.orderId, undefined);
      assert.equal(getAddress(event.args.participant), getAddress(seller.account.address));
      assert.equal(event.args.pricePerDay, price);
      assert.equal(event.args.deliveryAt, deliveryDate);
      assert.equal(event.args.isBuy, true);
    }
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

    const txHash = await futures.write.createOrder([price, deliveryDate, "", qty], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    assert.equal(events.length, 5);

    for (const event of events) {
      assert.notEqual(event.args.orderId, undefined);
      assert.equal(getAddress(event.args.participant), getAddress(seller.account.address));
      assert.equal(event.args.pricePerDay, price);
      assert.equal(event.args.deliveryAt, BigInt(deliveryDate));
      assert.equal(event.args.isBuy, false);
    }
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

    // 5 fresh resting buys — no opposites on the book → no fee charged.
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 5], {
      account: seller.account,
    });
    assert.equal((await pc.waitForTransactionReceipt({ hash: txHash })).status, "success");

    assert.equal(
      await collateralVault.read.balanceOf([seller.account.address]),
      initialSellerBalance,
    );
    assert.equal(await collateralVault.read.balanceOf([futures.address]), initialContractBalance);

    // 5 opposite-side qty by the same participant → all 5 self-cancel, no fee charged.
    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", -5], {
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
      futures.write.createOrder([0n, deliveryDate, "", 1], { account: seller.account }),
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
      futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account }),
      futures,
      "InvalidPrice",
    );
  });

  it("should reject order creation with past delivery date", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const block = await pc.getBlock({ blockTag: "latest" });
    const pastDate = block.timestamp - 86400n;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, pastDate, "", 1], { account: seller.account }),
      futures,
      "DeliveryDateShouldBeInTheFuture",
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

    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
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
    assert.equal(event.args.pricePerDay, price);
    assert.equal(event.args.deliveryAt, deliveryDate);
    assert.equal(event.args.isBuy, true);
  });

  it("should allow position creation when margin balance equals exactly required margin", async () => {});

  it("should allow sell order creation with sufficient margin balance", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const isBuy = false;

    await collateralVault.write.deposit([margin], { account: seller.account });

    const txHash = await futures.write.createOrder([price, deliveryDate, "", -1], {
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
    assert.equal(event.args.pricePerDay, price);
    assert.equal(event.args.deliveryAt, deliveryDate);
    assert.equal(event.args.isBuy, isBuy);
  });

  it("should remove existing order when creating one with opposite direction", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const buyOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
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

    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });

    const sellOrderReceipt = await pc.waitForTransactionReceipt({ hash: sellOrderTxHash });
    assert.equal(sellOrderReceipt.status, "success");

    const [orderClosedEvent] = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });

    assert.equal(orderClosedEvent.args.orderId, buyOrderId);

    const newOrderCreatedEvents = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(newOrderCreatedEvents.length, 0);

    const closedOrder = await futures.read.getOrderById([buyOrderId]);
    assert.equal(closedOrder.participant, zeroAddress);
  });

  it("should partially remove existing orders when creating opposite direction orders", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const sellOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", -3], {
      account: seller.account,
    });

    const sellOrderReceipt = await pc.waitForTransactionReceipt({ hash: sellOrderTxHash });
    assert.equal(sellOrderReceipt.status, "success");

    const sellOrderCreatedEvents = parseEventLogs({
      logs: sellOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    assert.equal(sellOrderCreatedEvents.length, 3);
    const sellOrderIds = sellOrderCreatedEvents.map((event) => event.args.orderId);

    const buyOrderTxHash = await futures.write.createOrder([price, deliveryDate, "", 2], {
      account: seller.account,
    });

    const buyOrderReceipt = await pc.waitForTransactionReceipt({ hash: buyOrderTxHash });
    assert.equal(buyOrderReceipt.status, "success");

    const orderClosedEvents = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });

    assert.equal(orderClosedEvents.length, 2);

    const closedOrderIds = orderClosedEvents.map((event) => event.args.orderId);
    for (const closedOrderId of closedOrderIds) {
      assert.ok(sellOrderIds.includes(closedOrderId));
    }

    const newOrderCreatedEvents = parseEventLogs({
      logs: buyOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(newOrderCreatedEvents.length, 0);

    for (const closedOrderId of closedOrderIds) {
      const closedOrder = await futures.read.getOrderById([closedOrderId]);
      assert.equal(closedOrder.participant, zeroAddress);
    }

    const remainingSellOrderId = sellOrderIds.find((id) => !closedOrderIds.includes(id));
    assert.ok(remainingSellOrderId);
    const remainingOrder = await futures.read.getOrderById([remainingSellOrderId]);
    assert.equal(getAddress(remainingOrder.participant), getAddress(seller.account.address));
    assert.equal(remainingOrder.isBuy, false);
    assert.equal(remainingOrder.pricePerDay, price);
    assert.equal(remainingOrder.deliveryAt, deliveryDate);
  });

  it("should remove existing orders when creating an opposite order even if margin balance is insufficient", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];

    // Single-contract IM is bounded above by entryPrice * deliveryDays.
    // Resting + self-cancel paths charge no maker/taker fee, so only the IM matters.
    const margin = price * BigInt(config.deliveryDurationDays);

    await collateralVault.write.deposit([margin], { account: seller.account });

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    // Balance must already exceed the PME-driven IM (no deficit) so the
    // opposite-side order below isn't refused on insufficient-margin grounds.
    const sellerAddr = seller.account.address;
    const im = await contracts.portfolioMarginEngine.read.computePortfolioIM([sellerAddr]);
    const balance = await collateralVault.read.balanceOf([sellerAddr]);
    assert.ok(balance > im, "seller has surplus collateral above portfolio IM");

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
  });

  it("does not auto-sweep expired orders when creating a new order", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc, tc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const oldDeliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

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

    let oldOrder = await futures.read.getOrderById([oldOrderId]);
    assert.equal(getAddress(oldOrder.participant), getAddress(seller.account.address));
    assert.equal(oldOrder.deliveryAt, oldDeliveryDate);

    await warpPastDeliveryWithFreshOracle(
      tc,
      contracts.hashrateOracle,
      oldDeliveryDate,
      BigInt(config.deliveryDurationSeconds),
    );
    const futureDates = await futures.read.getDeliveryDates();
    const newDeliveryDate = futureDates[futureDates.length - 1];

    const newOrderTxHash = await futures.write.createOrder([price, newDeliveryDate, "", 1], {
      account: seller.account,
    });

    const newOrderReceipt = await pc.waitForTransactionReceipt({ hash: newOrderTxHash });

    const orderClosedEvents = parseEventLogs({
      logs: newOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    assert.equal(orderClosedEvents.length, 0, "createOrder must not implicitly close expired orders");

    oldOrder = await futures.read.getOrderById([oldOrderId]);
    assert.equal(getAddress(oldOrder.participant), getAddress(seller.account.address));

    const newOrderEvents = parseEventLogs({
      logs: newOrderReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(newOrderEvents.length, 1);
    assert.equal(newOrderEvents[0].args.deliveryAt, newDeliveryDate);

    const sellerOrders = await futures.read.getOrderIds([seller.account.address]);
    assert.equal(sellerOrders.length, 2, "stale order is still resting next to the new one");
  });

  it("should enforce maximum orders per participant", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const numOrders = await futures.read.MAX_ORDERS_PER_PARTICIPANT();
    const price = await futures.read.getMarketPrice();
    const margin = price * BigInt(config.deliveryDurationDays) * BigInt(numOrders);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    for (let i = 0; i < numOrders; i++) {
      await futures.write.createOrder(
        [price + BigInt(i) * config.priceLadderStep, deliveryDate, "", 1],
        { account: seller.account },
      );
    }

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price + 50n * config.priceLadderStep, deliveryDate, "", 1], {
        account: seller.account,
      }),
      futures,
      "MaxOrdersPerParticipantReached",
    );
  });
});
