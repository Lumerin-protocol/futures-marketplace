/**
 * Integration tests: under-exercised `OrderEntryStatus` transitions.
 *
 * The order-lifecycle suite covers the common ACTIVE → MATCHED / CANCELLED
 * paths. This file pins down the rarer terminal states the indexer must
 * still map correctly:
 *   - EXPIRED:    after `deliveryAt`, anyone can permissionlessly call
 *                 `removeOutdatedOrder(orderId)` to close the stale order
 *                 (`OrderCloseReason = 2`). The contract no longer auto-sweeps
 *                 on `createOrder`; keepers or the owner clean up explicitly,
 *                 batching via the inherited `multicall(bytes[])`.
 *   - LIQUIDATED: permissionless `liquidateOrders` force-cancels resting orders before touching
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
import { assertHexHash, priceLevelId } from "./helpers.ts";

const conn = await network.create({ override: { loggingEnabled: true } });
const { matchstick } = conn;

describe("OrderEntryStatus.EXPIRED: removeOutdatedOrder", () => {
  after(() => matchstick.reset());

  it("closes a stale resting order and flips OrderEntry.status to EXPIRED", async () => {
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

    const sweepTx = await futures.write.removeOutdatedOrder([restingOrderId], {
      account: seller.account,
    });
    const sweepReceipt = await pc.waitForTransactionReceipt({ hash: sweepTx });
    const orderClosedEvents = parseEventLogs({
      logs: sweepReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    assert.equal(orderClosedEvents.length, 1, "must emit exactly one OrderClosed");
    assert.equal(
      orderClosedEvents[0].args.reason,
      2,
      "must emit OrderClosed with reason=2 (EXPIRED)",
    );

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const level = priceLevelId(deliveryDate, price, false);
    const snap = await matchstick.indexSnapshot([
      read("OrderEntry", restingOrderId),
      read("PriceLevel", level),
      read("User", sellerAddr),
      read("Futures", "0"),
    ]);

    const expiredEntry = snap.entity("OrderEntry", restingOrderId);
    assert.ok(expiredEntry);
    assert.equal(
      expiredEntry.status,
      "EXPIRED",
      "OrderEntry must map OrderCloseReason.EXPIRED to status=EXPIRED",
    );
    // Field-coverage: OrderEntry close metadata after EXPIRED sweep.
    assert.ok(
      expiredEntry.closedAt != null && BigInt(String(expiredEntry.closedAt)) > 0n,
      "OrderEntry.closedAt is set on EXPIRED",
    );
    // matchstick-ts stamps a default mock 20-byte value on `event.transaction.from`,
    // so we only verify the field is populated as a hex address (not the real EOA).
    assertHexHash(expiredEntry.closedByTx, "OrderEntry.closedByTx after EXPIRED");

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

describe("OrderEntryStatus.LIQUIDATED: liquidateOrders force-cancels resting orders", () => {
  after(() => matchstick.reset());

  it("flips a resting OrderEntry.status to LIQUIDATED via permissionless liquidateOrders", async () => {
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

    const liqTx = await futures.write.liquidateOrders([seller.account.address], {
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
    assert.ok(liquidatedClose, "the resting order must be closed during liquidateOrders");
    assert.equal(
      liquidatedClose.args.reason,
      3,
      "liquidateOrders must emit OrderClosed with reason=3 (LIQUIDATED) on the resting order",
    );

    const snap = await matchstick.indexSnapshot([read("OrderEntry", restingOrderId)]);
    const liqEntry = snap.entity("OrderEntry", restingOrderId);
    assert.ok(liqEntry);
    assert.equal(
      liqEntry.status,
      "LIQUIDATED",
      "OrderEntry must map OrderCloseReason.LIQUIDATED to status=LIQUIDATED",
    );
    // Field-coverage: `handleOrderLiquidated` writes `liquidator` and
    // `liquidationFee` from the OrderLiquidated event params (real values from
    // the on-chain event, NOT the matchstick mock tx.from).
    assert.equal(
      String(liqEntry.liquidator).toLowerCase(),
      validator.account.address.toLowerCase(),
      "OrderEntry.liquidator = OrderLiquidated.liquidator (validator EOA)",
    );
    assert.equal(
      String(liqEntry.liquidationFee),
      "0",
      "Futures.liquidationFee defaults to 0 in fixture → OrderLiquidated.fee=0",
    );
  });
});
