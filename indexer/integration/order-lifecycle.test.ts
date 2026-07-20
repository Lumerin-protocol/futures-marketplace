/**
 * Integration tests: Order entity lifecycle.
 *
 * Covers the multi-unit Order aggregate, OrderEntry status transitions
 * (ACTIVE → MATCHED or CANCELLED), PriceLevel totalQuantity bookkeeping,
 * and global Futures order counters.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { assertHexHash, priceLevelId } from "./helpers.ts";

const conn = await network.getOrCreate();

// ---------------------------------------------------------------------------
// Test 1: qty=3 sell order — aggregate Order, 1 OrderEntry, PriceLevel
// ---------------------------------------------------------------------------
describe("qty=3 single sell order: Order aggregate and OrderEntry promotion", () => {
  after(() => conn.matchstick.reset());

  it("ACTIVE → FILLED after buyer matches all 3 units", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller places qty=-3 in one call → 1 OrderCreated event, 1 OrderEntry with remainingQuantity=3
    const sellerTx = await futures.write.createOrder([price, deliveryDate, -3n], {
      account: seller.account,
    });
    const sellerReceipt = await pc.waitForTransactionReceipt({ hash: sellerTx });
    const sellerOrderEvents = parseEventLogs({
      logs: sellerReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(sellerOrderEvents.length, 1, "qty=-3 must produce 1 OrderCreated event");
    const makerOrderId = sellerOrderEvents[0].args.orderId.toLowerCase() as `0x${string}`;

    const levelId = priceLevelId(deliveryDate, price, false); // seller = ask side

    // --- ACTIVE state: entry active with remainingQuantity=3, PriceLevel at 3 ---
    const snap1 = await conn.matchstick.indexSnapshot([
      read("OrderEntry", makerOrderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;

    const [order1] = snap1.saved("Order");
    assert.ok(order1, "Order aggregate must exist");
    assert.equal(String(order1.originalQuantity), "3");
    assert.equal(String(order1.quantity), "3");
    assert.equal(String(order1.filledQuantity), "0");
    assert.equal(String(order1.cancelledQuantity), "0");
    assert.equal(order1.status, "ACTIVE");
    assert.equal(order1.isBuy, false);

    // Field-coverage: lock in the rest of the Order aggregate.
    assert.equal(String(order1.user).toLowerCase(), sellerAddr, "Order.user mirrors maker EOA");
    assert.equal(String(order1.price), price.toString(), "Order.price = createOrder price");
    assert.equal(
      String(order1.deliveryAt),
      deliveryDate.toString(),
      "Order.deliveryAt = createOrder delivery date",
    );
    assert.ok(BigInt(String(order1.createdAt)) > 0n, "Order.createdAt set from event.block.timestamp");
    assert.ok(BigInt(String(order1.updatedAt)) > 0n, "Order.updatedAt set on every save");
    assert.ok(order1.closedAt == null, "Order.closedAt stays unset while ACTIVE");
    assert.ok(BigInt(String(order1.blockNumber)) > 0n, "Order.blockNumber set from event.block.number");
    assert.equal(
      String(order1.transactionHash).toLowerCase(),
      sellerTx.toLowerCase(),
      "Order.transactionHash mirrors the createOrder tx hash",
    );

    const entry = snap1.entity("OrderEntry", makerOrderId);
    assert.ok(entry, `OrderEntry ${makerOrderId} must exist`);
    assert.equal(entry.status, "ACTIVE");
    assert.equal(String(entry.remainingQuantity), "3");
    assert.equal(String(entry.id).toLowerCase(), makerOrderId, "OrderEntry.id = on-chain orderId");
    assert.equal(
      String(entry.order).toLowerCase(),
      String(order1.id).toLowerCase(),
      "OrderEntry.order points back at the Order aggregate",
    );
    assert.ok(entry.closedAt == null, "OrderEntry.closedAt stays unset while ACTIVE");
    assert.ok(entry.closedByTx == null, "OrderEntry.closedByTx stays unset while ACTIVE");

    const level1 = snap1.entity("PriceLevel", levelId);
    assert.ok(level1, "PriceLevel must exist");
    assert.equal(String(level1.totalQuantity), "3");

    assert.equal(String(snap1.entity("Futures", "0")?.activeOrders), "1");
    assert.equal(String(snap1.entity("Futures", "0")?.totalOrders), "1");

    // --- Buyer matches all 3 in one call ---
    const buyTx = await futures.write.createOrder([price, deliveryDate, 3n], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const matchEvents = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matchEvents.length, 1, "buyer matching all 3 must produce 1 OrderMatched");

    // --- FILLED state ---
    const snap2 = await conn.matchstick.indexSnapshot([
      read("OrderEntry", makerOrderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const [order2] = snap2.saved("Order");
    assert.ok(order2);
    assert.equal(String(order2.filledQuantity), "3");
    assert.equal(String(order2.quantity), "0", "remaining quantity must be 0 after full fill");
    assert.equal(order2.status, "FILLED");

    // Field-coverage: terminal-transition metadata.
    assert.ok(
      order2.closedAt != null && BigInt(String(order2.closedAt)) > 0n,
      "Order.closedAt is set on the terminal FILLED transition (recomputeOrderStatus)",
    );
    assert.ok(
      BigInt(String(order2.updatedAt)) >= BigInt(String(order1.updatedAt)),
      "Order.updatedAt is monotonically non-decreasing",
    );

    const filledEntry = snap2.entity("OrderEntry", makerOrderId);
    assert.ok(filledEntry);
    assert.equal(filledEntry.status, "MATCHED", "OrderEntry must be MATCHED after fill");
    assert.equal(String(filledEntry.remainingQuantity), "0");
    assert.ok(
      filledEntry.closedAt != null && BigInt(String(filledEntry.closedAt)) > 0n,
      "OrderEntry.closedAt is set on the OrderUpdated(0) fill",
    );
    assertHexHash(filledEntry.closedByTx, "OrderEntry.closedByTx after MATCHED");

    const level2 = snap2.entity("PriceLevel", levelId);
    assert.ok(level2);
    assert.equal(
      String(level2.totalQuantity),
      "0",
      "PriceLevel totalQuantity must be 0 after full fill",
    );

    assert.equal(
      String(snap2.entity("Futures", "0")?.activeOrders),
      "0",
      "activeOrders must be 0 after order is filled",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: order cancellation — OrderEntry CANCELLED, counters decremented
// ---------------------------------------------------------------------------
describe("order cancellation: OrderEntry CANCELLED, PriceLevel and Futures decremented", () => {
  after(() => conn.matchstick.reset());

  it("cancelling a qty=2 order flips Order.status to CANCELLED and decrements activeOrders", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller places qty=-2 → 1 OrderCreated event, 1 OrderEntry with remainingQuantity=2
    const sellerTx = await futures.write.createOrder([price, deliveryDate, -2n], {
      account: seller.account,
    });
    const sellerReceipt = await pc.waitForTransactionReceipt({ hash: sellerTx });
    const orderEvents = parseEventLogs({
      logs: sellerReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(orderEvents.length, 1);
    const orderId = orderEvents[0].args.orderId.toLowerCase() as `0x${string}`;
    const levelId = priceLevelId(deliveryDate, price, false);

    const snap1 = await conn.matchstick.indexSnapshot([
      read("OrderEntry", orderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);
    assert.equal(String(snap1.entity("OrderEntry", orderId)?.remainingQuantity), "2");
    assert.equal(String(snap1.entity("Futures", "0")?.activeOrders), "1");

    // Cancel the entire resting order
    await futures.write.cancelOrder([orderId], { account: seller.account });

    const snap2 = await conn.matchstick.indexSnapshot([
      read("OrderEntry", orderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    assert.equal(snap2.entity("OrderEntry", orderId)?.status, "CANCELLED");
    assert.equal(String(snap2.entity("OrderEntry", orderId)?.remainingQuantity), "0");

    const [order2] = snap2.saved("Order");
    assert.ok(order2);
    assert.equal(String(order2.cancelledQuantity), "2");
    assert.equal(String(order2.quantity), "0");
    assert.equal(order2.status, "CANCELLED");

    assert.equal(
      String(snap2.entity("PriceLevel", levelId)?.totalQuantity),
      "0",
    );
    assert.equal(
      String(snap2.entity("Futures", "0")?.activeOrders),
      "0",
      "activeOrders must be 0 after full cancellation",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: partial fill — Order.status=PARTIAL, remaining entry stays ACTIVE
// ---------------------------------------------------------------------------
describe("partial fill: Order PARTIAL, unfilled quantity stays ACTIVE", () => {
  after(() => conn.matchstick.reset());

  it("buyer fills 1 of 3 → Order.filledQty=1, quantity=2, status=PARTIAL", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller rests 3 units in one order
    const sellerTx = await futures.write.createOrder([price, deliveryDate, -3n], {
      account: seller.account,
    });
    const sellerReceipt = await pc.waitForTransactionReceipt({ hash: sellerTx });
    const orderEvents = parseEventLogs({
      logs: sellerReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const makerOrderId = orderEvents[0].args.orderId.toLowerCase() as `0x${string}`;

    // Buyer takes only 1
    await futures.write.createOrder([price, deliveryDate, 1n], { account: buyer.account });

    const levelId = priceLevelId(deliveryDate, price, false);

    const snap = await conn.matchstick.indexSnapshot([
      read("OrderEntry", makerOrderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const [order] = snap.saved("Order");
    assert.ok(order);
    assert.equal(String(order.filledQuantity), "1", "1 unit filled");
    assert.equal(String(order.quantity), "2", "2 units still active");
    assert.equal(String(order.cancelledQuantity), "0");
    assert.equal(order.status, "PARTIAL");

    const entry = snap.entity("OrderEntry", makerOrderId);
    assert.ok(entry);
    assert.equal(entry.status, "ACTIVE", "partially filled entry stays ACTIVE");
    assert.equal(String(entry.remainingQuantity), "2");

    assert.equal(
      String(snap.entity("PriceLevel", levelId)?.totalQuantity),
      "2",
      "PriceLevel.totalQuantity=2 (1 filled, 2 resting)",
    );
    assert.equal(
      String(snap.entity("Futures", "0")?.activeOrders),
      "1",
      "1 active OrderEntry (partial: 1 matched, 2 still resting on same orderId)",
    );
  });
});
