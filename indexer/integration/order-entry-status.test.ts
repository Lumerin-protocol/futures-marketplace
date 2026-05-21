/**
 * Integration tests: under-exercised `OrderEntryStatus` transitions.
 *
 * The order-lifecycle suite covers the common ACTIVE → MATCHED / CANCELLED
 * paths. This file pins down the rarer terminal states the indexer must
 * still map correctly:
 *   - EXPIRED:    after `deliveryAt`, `removeOutdatedOrdersForParticipant`
 *                 sweeps stale orders. (`OrderCloseReason = 2`)
 *   - LIQUIDATED: `marginCall` force-closes resting orders before touching
 *                 positions. (`OrderCloseReason = 3`)
 *
 * (The RESET status is covered by `lot-reset.test.ts`.)
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice, scaleHashprice } from "../../contracts/tests/utils.ts";
import { priceLevelId } from "./helpers.ts";

const conn = await network.create({ override: { loggingEnabled: true } });
const { matchstick } = conn;

describe("OrderEntryStatus.EXPIRED: removeOutdatedOrdersForParticipant", () => {
  after(() => matchstick.reset());

  it("sweeps stale resting orders and flips OrderEntry.status to EXPIRED", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, pc, tc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });

    matchstick.bind("Futures", futures.address, futures.abi);
    await matchstick.captureViewMocks();
    await matchstick.anchor();

    // Seller rests an order.
    const restTx = await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    const restReceipt = await pc.waitForTransactionReceipt({ hash: restTx });
    const [restingOrder] = parseEventLogs({
      logs: restReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const restingOrderId = restingOrder.args.orderId.toLowerCase() as `0x${string}`;

    // Fast-forward past deliveryAt so the order qualifies as outdated.
    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.deliveryDurationSeconds) + 1n,
    });

    const sweepTx = await futures.write.removeOutdatedOrdersForParticipant(
      [seller.account.address],
      { account: seller.account },
    );
    const sweepReceipt = await pc.waitForTransactionReceipt({ hash: sweepTx });
    const orderClosedEvents = parseEventLogs({
      logs: sweepReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    assert.ok(orderClosedEvents.length >= 1, "sweep must emit at least one OrderClosed");
    assert.ok(
      orderClosedEvents.some((e) => e.args.reason === 2),
      "sweep must emit OrderClosed with reason=2 (EXPIRED)",
    );

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const level = priceLevelId(deliveryDate, price, false);
    const snap = await matchstick.indexSnapshot([
      read("OrderEntry", restingOrderId),
      read("PriceLevel", level),
      read("User", sellerAddr),
      read("Futures", "0"),
    ]);

    assert.equal(
      snap.entity("OrderEntry", restingOrderId)?.status,
      "EXPIRED",
      "OrderEntry must map OrderCloseReason.EXPIRED to status=EXPIRED",
    );

    // The parent Order aggregate becomes CANCELLED (every entry is non-MATCHED).
    const [order] = snap.saved("Order");
    assert.ok(order);
    assert.equal(order.status, "CANCELLED");
    assert.equal(String(order.cancelledQuantity), "1");
    assert.equal(String(order.quantity), "0");

    // PriceLevel must drop to 0.
    assert.equal(String(snap.entity("PriceLevel", level)?.totalQuantity), "0");

    // Futures.activeOrders drops back to 0.
    assert.equal(String(snap.entity("Futures", "0")?.activeOrders), "0");
    assert.equal(
      String(snap.entity("User", sellerAddr)?.activeOrderCount),
      "0",
      "User.activeOrderCount must drop when the only resting order expires",
    );
  });
});

describe("OrderEntryStatus.LIQUIDATED: marginCall force-closes resting orders", () => {
  after(() => matchstick.reset());

  it("flips resting OrderEntry.status to LIQUIDATED before touching positions", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const restingPrice = price + 5n * config.priceLadderStep; // far from market so it doesn't match
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    matchstick.bind("Futures", futures.address, futures.abi);
    await matchstick.captureViewMocks();

    // 1. Seller opens an underwater short position (to be liquidatable).
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "dst", 1], { account: buyer.account });

    // 2. Seller rests a second order (no match — it stays in the book).
    const restTx = await futures.write.createOrder([restingPrice, deliveryDate, "", -1], {
      account: seller.account,
    });
    const restReceipt = await pc.waitForTransactionReceipt({ hash: restTx });
    const [restingOrder] = parseEventLogs({
      logs: restReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const restingOrderId = restingOrder.args.orderId.toLowerCase() as `0x${string}`;

    // 3. Crash the market so the seller's portfolio MM is breached.
    await scaleHashprice(hashrateOracle, 40n, 1n);

    const liqTx = await futures.write.marginCall([seller.account.address], {
      account: validator.account,
    });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    // The resting OrderClosed must carry reason=3 (LIQUIDATED).
    const orderClosedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    const liquidatedClose = orderClosedEvents.find(
      (e) => e.args.orderId.toLowerCase() === restingOrderId,
    );
    assert.ok(liquidatedClose, "the resting order must be closed during marginCall");
    assert.equal(
      liquidatedClose.args.reason,
      3,
      "marginCall must emit OrderClosed with reason=3 (LIQUIDATED) on the resting order",
    );

    const snap = await matchstick.indexSnapshot([read("OrderEntry", restingOrderId)]);
    assert.equal(
      snap.entity("OrderEntry", restingOrderId)?.status,
      "LIQUIDATED",
      "OrderEntry must map OrderCloseReason.LIQUIDATED to status=LIQUIDATED",
    );
  });
});
