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
import { priceLevelId } from "./helpers.ts";

const conn = await network.getOrCreate();

// ---------------------------------------------------------------------------
// Test 1: qty=3 sell order — aggregate Order, 3 OrderEntries, PriceLevel
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

    // Seller places qty=-3 in one call → 3 OrderCreated events, 1 Order aggregate
    const sellerTx = await futures.write.createOrder([price, deliveryDate, "", -3], {
      account: seller.account,
    });
    const sellerReceipt = await pc.waitForTransactionReceipt({ hash: sellerTx });
    const sellerOrderEvents = parseEventLogs({
      logs: sellerReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(sellerOrderEvents.length, 3, "qty=3 must produce 3 OrderCreated events");
    const makerOrderIds = sellerOrderEvents.map(
      (e) => e.args.orderId.toLowerCase() as `0x${string}`,
    );

    const levelId = priceLevelId(deliveryDate, price, false); // seller = ask side

    // --- ACTIVE state: all 3 entries active, PriceLevel at 3 ---
    const snap1 = await conn.matchstick.indexSnapshot([
      ...makerOrderIds.map((id) => read("OrderEntry", id)),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const [order1] = snap1.saved("Order");
    assert.ok(order1, "Order aggregate must exist");
    assert.equal(String(order1.originalQuantity), "3");
    assert.equal(String(order1.quantity), "3");
    assert.equal(String(order1.filledQuantity), "0");
    assert.equal(String(order1.cancelledQuantity), "0");
    assert.equal(order1.status, "ACTIVE");
    assert.equal(order1.isBuy, false);

    for (const id of makerOrderIds) {
      const entry = snap1.entity("OrderEntry", id);
      assert.ok(entry, `OrderEntry ${id} must exist`);
      assert.equal(entry.status, "ACTIVE");
    }

    const level1 = snap1.entity("PriceLevel", levelId);
    assert.ok(level1, "PriceLevel must exist");
    assert.equal(String(level1.totalQuantity), "3");

    assert.equal(String(snap1.entity("Futures", "0")?.activeOrders), "1");
    assert.equal(String(snap1.entity("Futures", "0")?.totalOrders), "1");

    // --- Buyer matches all 3 in one call ---
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 3], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const lotEvents = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    assert.equal(lotEvents.length, 3, "buyer matching all 3 must produce 3 LotCreated");

    // --- FILLED state ---
    const snap2 = await conn.matchstick.indexSnapshot([
      ...makerOrderIds.map((id) => read("OrderEntry", id)),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const [order2] = snap2.saved("Order");
    assert.ok(order2);
    assert.equal(String(order2.filledQuantity), "3");
    assert.equal(String(order2.quantity), "0", "remaining quantity must be 0 after full fill");
    assert.equal(order2.status, "FILLED");

    for (const id of makerOrderIds) {
      const entry = snap2.entity("OrderEntry", id);
      assert.ok(entry);
      assert.equal(entry.status, "MATCHED", `OrderEntry ${id} must be MATCHED after fill`);
    }

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

  it("cancelling all entries flips Order.status to CANCELLED and decrements activeOrders", async () => {
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

    // Seller places qty=-2 → 2 OrderCreated events
    const sellerTx = await futures.write.createOrder([price, deliveryDate, "", -2], {
      account: seller.account,
    });
    const sellerReceipt = await pc.waitForTransactionReceipt({ hash: sellerTx });
    const orderEvents = parseEventLogs({
      logs: sellerReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(orderEvents.length, 2);
    const [orderId1, orderId2] = orderEvents.map(
      (e) => e.args.orderId.toLowerCase() as `0x${string}`,
    );
    const levelId = priceLevelId(deliveryDate, price, false);

    // Cancel first entry
    await futures.write.closeOrder([orderId1], { account: seller.account });

    const snap1 = await conn.matchstick.indexSnapshot([
      read("OrderEntry", orderId1),
      read("OrderEntry", orderId2),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    assert.equal(snap1.entity("OrderEntry", orderId1)?.status, "CANCELLED");
    assert.equal(snap1.entity("OrderEntry", orderId2)?.status, "ACTIVE");

    const [order1] = snap1.saved("Order");
    assert.ok(order1);
    assert.equal(String(order1.cancelledQuantity), "1");
    assert.equal(String(order1.quantity), "1", "1 active unit remaining");
    assert.equal(order1.status, "PARTIAL", "partially cancelled → PARTIAL");

    assert.equal(
      String(snap1.entity("PriceLevel", levelId)?.totalQuantity),
      "1",
      "PriceLevel must be 1 after cancelling 1 entry",
    );
    assert.equal(
      String(snap1.entity("Futures", "0")?.activeOrders),
      "1",
      "still 1 active order aggregate",
    );

    // Cancel second entry — order becomes fully CANCELLED
    await futures.write.closeOrder([orderId2], { account: seller.account });

    const snap2 = await conn.matchstick.indexSnapshot([
      read("OrderEntry", orderId2),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    assert.equal(snap2.entity("OrderEntry", orderId2)?.status, "CANCELLED");

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
// Test 3: partial fill — Order.status=PARTIAL, remaining entries ACTIVE
// ---------------------------------------------------------------------------
describe("partial fill: Order PARTIAL, unfilled entries stay ACTIVE", () => {
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

    // Seller rests 3 units
    const sellerTx = await futures.write.createOrder([price, deliveryDate, "", -3], {
      account: seller.account,
    });
    const sellerReceipt = await pc.waitForTransactionReceipt({ hash: sellerTx });
    const orderEvents = parseEventLogs({
      logs: sellerReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const makerOrderIds = orderEvents.map((e) => e.args.orderId.toLowerCase() as `0x${string}`);

    // Buyer takes only 1
    await futures.write.createOrder([price, deliveryDate, "dst", 1], { account: buyer.account });

    const levelId = priceLevelId(deliveryDate, price, false);

    const snap = await conn.matchstick.indexSnapshot([
      ...makerOrderIds.map((id) => read("OrderEntry", id)),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const [order] = snap.saved("Order");
    assert.ok(order);
    assert.equal(String(order.filledQuantity), "1", "1 unit filled");
    assert.equal(String(order.quantity), "2", "2 units still active");
    assert.equal(String(order.cancelledQuantity), "0");
    assert.equal(order.status, "PARTIAL");

    // The filled entry is MATCHED; the other two remain ACTIVE
    const entries = makerOrderIds.map((id) => snap.entity("OrderEntry", id));
    const matchedEntries = entries.filter((e) => e?.status === "MATCHED");
    const activeEntries = entries.filter((e) => e?.status === "ACTIVE");
    assert.equal(matchedEntries.length, 1, "1 entry MATCHED");
    assert.equal(activeEntries.length, 2, "2 entries still ACTIVE");

    assert.equal(
      String(snap.entity("PriceLevel", levelId)?.totalQuantity),
      "2",
      "PriceLevel.totalQuantity=2 (1 filled, 2 resting)",
    );
    assert.equal(
      String(snap.entity("Futures", "0")?.activeOrders),
      "1",
      "1 active order (partial)",
    );
  });
});
