/**
 * Integration tests: Order entity lifecycle.
 *
 * One Order row per on-chain orderId, so this covers its status transitions
 * (ACTIVE → PARTIALLY_FILLED → FILLED, or → CANCELLED), the remaining /
 * filled / cancelled quantity split, PriceLevel bookkeeping, and the global
 * Futures order counters.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { assertHexHash, priceLevelId } from "./helpers.ts";
import { TimeInForce } from "../../contracts/tests/timeInForce.ts";

const conn = await network.getOrCreate();

// ---------------------------------------------------------------------------
// Test 1: qty=3 sell order — one Order row, ACTIVE → FILLED
// ---------------------------------------------------------------------------
describe("qty=3 single sell order: one Order row keyed by orderId", () => {
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

    conn.matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller places qty=-3 in one call → 1 OrderCreated event, 1 Order row.
    const sellerTx = await futures.write.createOrder([price, deliveryDate, -3n, TimeInForce.GTC], {
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

    // --- ACTIVE state: 3 contracts resting, PriceLevel at 3 ---
    const snap1 = await conn.matchstick.indexSnapshot([
      read("Order", makerOrderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;

    const order1 = snap1.entity("Order", makerOrderId);
    assert.ok(order1, `Order ${makerOrderId} must exist`);
    assert.equal(
      String(order1.id).toLowerCase(),
      makerOrderId,
      "Order.id = on-chain orderId (the handle cancelOrder takes)",
    );
    assert.equal(String(order1.originalQuantity), "3");
    assert.equal(String(order1.quantity), "3");
    assert.equal(String(order1.filledQuantity), "0");
    assert.equal(String(order1.cancelledQuantity), "0");
    assert.equal(String(order1.averageFillPrice), "0");
    assert.equal(order1.status, "ACTIVE");
    assert.equal(order1.isBuy, false);

    // Field-coverage: lock in the rest of the Order row.
    assert.equal(String(order1.user).toLowerCase(), sellerAddr, "Order.user mirrors maker EOA");
    assert.equal(String(order1.price), price.toString(), "Order.price = createOrder price");
    assert.equal(
      String(order1.expirationAt),
      deliveryDate.toString(),
      "Order.expirationAt = createOrder expiration date",
    );
    assert.ok(BigInt(String(order1.createdAt)) > 0n, "Order.createdAt set from event.block.timestamp");
    assert.ok(BigInt(String(order1.updatedAt)) > 0n, "Order.updatedAt set on every save");
    assert.ok(order1.closedAt == null, "Order.closedAt stays unset while ACTIVE");
    assert.ok(order1.closedByTx == null, "Order.closedByTx stays unset while ACTIVE");
    assert.ok(BigInt(String(order1.blockNumber)) > 0n, "Order.blockNumber set from event.block.number");
    assert.equal(
      String(order1.transactionHash).toLowerCase(),
      sellerTx.toLowerCase(),
      "Order.transactionHash mirrors the createOrder tx hash",
    );

    const level1 = snap1.entity("PriceLevel", levelId);
    assert.ok(level1, "PriceLevel must exist");
    assert.equal(String(level1.totalQuantity), "3");
    assert.equal(String(level1.orderCount), "1");

    assert.equal(String(snap1.entity("Futures", "0")?.activeOrders), "1");
    assert.equal(String(snap1.entity("Futures", "0")?.totalOrders), "1");

    // --- Buyer matches all 3 in one call ---
    const buyTx = await futures.write.createOrder([price, deliveryDate, 3n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const matchEvents = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matchEvents.length, 1, "buyer matching all 3 must produce 1 OrderMatched");
    const takerOrderId = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    })[0].args.orderId.toLowerCase() as `0x${string}`;

    // --- FILLED state ---
    const snap2 = await conn.matchstick.indexSnapshot([
      read("Order", makerOrderId),
      read("Order", takerOrderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const order2 = snap2.entity("Order", makerOrderId);
    assert.ok(order2);
    assert.equal(String(order2.filledQuantity), "3");
    assert.equal(String(order2.quantity), "0", "remaining quantity must be 0 after full fill");
    assert.equal(String(order2.cancelledQuantity), "0");
    assert.equal(String(order2.averageFillPrice), price.toString());
    assert.equal(order2.status, "FILLED");

    // Field-coverage: terminal-transition metadata.
    assert.ok(
      order2.closedAt != null && BigInt(String(order2.closedAt)) > 0n,
      "Order.closedAt is set on the terminal FILLED transition",
    );
    assertHexHash(order2.closedByTx, "Order.closedByTx after FILLED");
    assert.ok(
      BigInt(String(order2.updatedAt)) >= BigInt(String(order1.updatedAt)),
      "Order.updatedAt is monotonically non-decreasing",
    );

    // The taker's own order is credited too — OrderMatched only names the maker,
    // so the taker side is attributed via User.lastCreatedOrderId.
    const takerOrder = snap2.entity("Order", takerOrderId);
    assert.ok(takerOrder, `taker Order ${takerOrderId} must exist`);
    assert.equal(String(takerOrder.filledQuantity), "3", "taker order is credited its own fill");
    assert.equal(String(takerOrder.averageFillPrice), price.toString());
    assert.equal(takerOrder.status, "FILLED");

    const level2 = snap2.entity("PriceLevel", levelId);
    assert.ok(level2);
    assert.equal(
      String(level2.totalQuantity),
      "0",
      "PriceLevel totalQuantity must be 0 after full fill",
    );
    assert.equal(String(level2.orderCount), "0");

    assert.equal(
      String(snap2.entity("Futures", "0")?.activeOrders),
      "0",
      "activeOrders must be 0 after both orders close",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: order cancellation — Order CANCELLED, counters decremented
// ---------------------------------------------------------------------------
describe("order cancellation: Order CANCELLED, PriceLevel and Futures decremented", () => {
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

    conn.matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller places qty=-2 → 1 OrderCreated event, 1 Order row.
    const sellerTx = await futures.write.createOrder([price, deliveryDate, -2n, TimeInForce.GTC], {
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
      read("Order", orderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);
    assert.equal(String(snap1.entity("Order", orderId)?.quantity), "2");
    assert.equal(String(snap1.entity("Futures", "0")?.activeOrders), "1");

    // Cancel the entire resting order
    await futures.write.cancelOrder([orderId], { account: seller.account });

    const snap2 = await conn.matchstick.indexSnapshot([
      read("Order", orderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const order2 = snap2.entity("Order", orderId);
    assert.ok(order2);
    assert.equal(order2.status, "CANCELLED");
    assert.equal(String(order2.cancelledQuantity), "2");
    assert.equal(String(order2.filledQuantity), "0");
    assert.equal(String(order2.quantity), "0");
    assert.ok(
      order2.closedAt != null && BigInt(String(order2.closedAt)) > 0n,
      "Order.closedAt is set on the terminal CANCELLED transition",
    );
    assertHexHash(order2.closedByTx, "Order.closedByTx after CANCELLED");

    assert.equal(
      String(snap2.entity("PriceLevel", levelId)?.totalQuantity),
      "0",
    );
    assert.equal(String(snap2.entity("PriceLevel", levelId)?.orderCount), "0");
    assert.equal(
      String(snap2.entity("Futures", "0")?.activeOrders),
      "0",
      "activeOrders must be 0 after full cancellation",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: partial fill — Order.status=PARTIALLY_FILLED, remainder keeps resting
// ---------------------------------------------------------------------------
describe("partial fill: Order PARTIALLY_FILLED, unfilled quantity keeps resting", () => {
  after(() => conn.matchstick.reset());

  it("buyer fills 1 of 3 → Order.filledQty=1, quantity=2, status=PARTIALLY_FILLED", async () => {
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

    conn.matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller rests 3 units in one order
    const sellerTx = await futures.write.createOrder([price, deliveryDate, -3n, TimeInForce.GTC], {
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
    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], { account: buyer.account });

    const levelId = priceLevelId(deliveryDate, price, false);

    const snap = await conn.matchstick.indexSnapshot([
      read("Order", makerOrderId),
      read("PriceLevel", levelId),
      read("Futures", "0"),
    ]);

    const order = snap.entity("Order", makerOrderId);
    assert.ok(order);
    assert.equal(String(order.filledQuantity), "1", "1 contract filled");
    assert.equal(String(order.quantity), "2", "2 contracts still resting");
    assert.equal(String(order.cancelledQuantity), "0");
    assert.equal(String(order.averageFillPrice), price.toString());
    assert.equal(order.status, "PARTIALLY_FILLED");
    assert.ok(order.closedAt == null, "a partially filled order is not terminal");

    assert.equal(
      String(snap.entity("PriceLevel", levelId)?.totalQuantity),
      "2",
      "PriceLevel.totalQuantity=2 (1 filled, 2 resting)",
    );
    assert.equal(
      String(snap.entity("PriceLevel", levelId)?.orderCount),
      "1",
      "the partially filled order keeps its slot in the book",
    );
    assert.equal(
      String(snap.entity("Futures", "0")?.activeOrders),
      "1",
      "only the maker order still rests; the buyer's order closed on the fill",
    );
  });
});
