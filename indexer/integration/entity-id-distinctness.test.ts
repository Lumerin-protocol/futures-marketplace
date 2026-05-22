/**
 * Integration tests: entity-ID distinctness across blocks/txs.
 *
 * All of these scenarios produce entities whose IDs include the on-chain
 * `transactionHash`, `blockNumber`, or `logIndex`. Before matchstick-ts v0.3.0
 * those fields were constants on the mock event, so distinct on-chain events
 * silently collapsed into a single entity row. These tests pin down the
 * realistic post-v0.3.0 behavior so a regression in either the harness or the
 * indexer ID functions trips immediately.
 *
 * Coverage:
 *   - `PositionSession.id` rotates across open → close → re-open on the same
 *     `(user, deliveryAt)` pair (ID format: blockNumber + logIndex + side).
 *   - `Trade.id` is per-tx (`tx hash + user + sessionId`): two separate trade
 *     txs by one user → two distinct `Trade` entities.
 *   - `Order.id` is per-tx (`tx hash + user + price + deliveryAt + side`):
 *     identical-shape orders in two different txs → two distinct `Order`
 *     aggregates.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read, type EntityFields } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { assertBlockNumberMonotonic, pointerId } from "./helpers.ts";

const conn = await network.getOrCreate();

describe("PositionSession ID rotation: close → re-open on same (user, deliveryAt)", () => {
  after(() => conn.matchstick.reset());

  it("creates two distinct PositionSession entities, one CLOSE then one OPEN", async () => {
    const { contracts, accounts, config } =
      await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // 1. Open lot 1 (seller short, buyer long).
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const openTx1 = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const openReceipt1 = await pc.waitForTransactionReceipt({ hash: openTx1 });
    const [created1] = parseEventLogs({
      logs: openReceipt1.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lot1Id = created1.args.lotId.toLowerCase() as `0x${string}`;

    // 2. Mutual exit: seller buys back, buyer sells back → LotClosed(MUTUAL_EXIT).
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "dst", -1], { account: buyer.account });

    // 3. Open lot 2 on the same (user, deliveryAt) — must produce a NEW
    // PositionSession with a distinct ID (different blockNumber + logIndex).
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const openTx2 = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const openReceipt2 = await pc.waitForTransactionReceipt({ hash: openTx2 });
    const [created2] = parseEventLogs({
      logs: openReceipt2.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lot2Id = created2.args.lotId.toLowerCase() as `0x${string}`;
    assert.notEqual(lot1Id, lot2Id, "different lots must have different ids");

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(seller.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(buyer.account.address, deliveryDate)),
    ]);

    // Pointer is back to flat after mutual exit, then +/-1 again after lot 2.
    const sellerPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(seller.account.address, deliveryDate),
    );
    const buyerPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(buyer.account.address, deliveryDate),
    );
    assert.ok(sellerPtr);
    assert.ok(buyerPtr);
    assert.equal(String(sellerPtr.netQuantity), "-1", "seller short again after lot 2");
    assert.equal(String(buyerPtr.netQuantity), "1", "buyer long again after lot 2");

    // --- PositionSession entities: two per side, distinct IDs ---
    const sessions = snap.saved("PositionSession");
    const sellerSessions = sessions.filter(
      (s: EntityFields) => String(s.user).toLowerCase() === sellerAddr,
    );
    const buyerSessions = sessions.filter(
      (s: EntityFields) => String(s.user).toLowerCase() === buyerAddr,
    );
    assert.equal(sellerSessions.length, 2, "seller has one CLOSE + one OPEN session");
    assert.equal(buyerSessions.length, 2, "buyer has one CLOSE + one OPEN session");

    // The two session IDs MUST differ — pre-v0.3.0 they collapsed because
    // both block.number and logIndex were the matchstick-as defaults.
    const sellerSessionIds = sellerSessions.map((s: EntityFields) => String(s.id));
    assert.equal(
      new Set(sellerSessionIds).size,
      2,
      `seller PositionSession ids must be distinct, got ${sellerSessionIds.join(", ")}`,
    );

    const closedSession = sellerSessions.find((s: EntityFields) => s.status === "CLOSE");
    const openSession = sellerSessions.find((s: EntityFields) => s.status === "OPEN");
    assert.ok(closedSession, "seller has a CLOSE session (the mutual exit)");
    assert.ok(openSession, "seller has an OPEN session (lot 2)");
    assert.equal(String(closedSession.netQuantity), "0");
    assert.equal(String(openSession.netQuantity), "-1");
    assert.notEqual(String(closedSession.id), String(openSession.id));

    // Pointer must reference the OPEN session, not the closed one.
    assert.equal(
      String(sellerPtr.currentSessionId),
      String(openSession.id),
      "pointer.currentSessionId must point at the live OPEN session",
    );
  });
});

describe("Trade.id is per-tx: two trade txs by one user", () => {
  after(() => conn.matchstick.reset());

  it("produces two distinct Trade entities and User.tradeCount = 2", async () => {
    const { contracts, accounts, config } =
      await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const price2 = price + config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Trade 1: seller sells at `price`, buyer fills.
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx1 = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buyTx1 });

    // Trade 2: seller sells at `price2`, buyer fills. New (tx, user, session)
    // tuple because the previous session is still OPEN — so the seller's
    // existing session aggregates the second fill but the buyer gets a
    // distinct Trade row per tx because the tradeId includes the tx hash.
    await futures.write.createOrder([price2, deliveryDate, "", -1], { account: seller.account });
    const buyTx2 = await futures.write.createOrder([price2, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buyTx2 });

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("User", sellerAddr),
      read("User", buyerAddr),
    ]);

    const trades = snap.saved("Trade");
    const sellerTrades = trades.filter(
      (t: EntityFields) => String(t.user).toLowerCase() === sellerAddr,
    );
    const buyerTrades = trades.filter(
      (t: EntityFields) => String(t.user).toLowerCase() === buyerAddr,
    );

    // Two trades per side, one per tx.
    assert.equal(sellerTrades.length, 2, "seller has one Trade per tx");
    assert.equal(buyerTrades.length, 2, "buyer has one Trade per tx");

    // IDs must be distinct — they share user+session but differ on tx hash.
    const sellerTradeIds = sellerTrades.map((t: EntityFields) => String(t.id));
    assert.equal(new Set(sellerTradeIds).size, 2, "seller Trade ids must be distinct across txs");

    // Trade txHashes must differ between the two trades.
    const sellerTxHashes = sellerTrades.map((t: EntityFields) => String(t.transactionHash));
    assert.equal(
      new Set(sellerTxHashes).size,
      2,
      `seller Trade.transactionHash values must differ across txs, got ${sellerTxHashes.join(", ")}`,
    );

    // User.tradeCount counts unique trades.
    assert.equal(String(snap.entity("User", sellerAddr)?.tradeCount), "2");
    assert.equal(String(snap.entity("User", buyerAddr)?.tradeCount), "2");

    // blockNumber monotonic across the two trades.
    const sortedSellerTrades = [...sellerTrades].sort(
      (a, b) => Number(a.blockNumber) - Number(b.blockNumber),
    );
    assertBlockNumberMonotonic(sortedSellerTrades, "seller Trade");
  });
});

describe("Order.id is per-tx: identical-shape orders in different txs", () => {
  after(() => conn.matchstick.reset());

  it("creates two distinct Order aggregates even with identical (user, price, deliveryAt, side)", async () => {
    const { contracts, accounts, config } =
      await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Same (user, price, deliveryAt, side) but two distinct transactions.
    const tx1 = await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    await pc.waitForTransactionReceipt({ hash: tx1 });

    const tx2 = await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    await pc.waitForTransactionReceipt({ hash: tx2 });

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const snap = await conn.matchstick.indexSnapshot([read("User", sellerAddr)]);

    const orders = snap.saved("Order");
    assert.equal(orders.length, 2, "identical-shape orders in different txs must NOT collapse");

    const orderIds = orders.map((o: EntityFields) => String(o.id));
    assert.equal(
      new Set(orderIds).size,
      2,
      `Order.id must differ when tx hash differs (got ${orderIds.join(", ")})`,
    );

    // Each Order has its own (single-entry) OrderEntry.
    for (const order of orders) {
      assert.equal(String(order.originalQuantity), "1");
      assert.equal(String(order.quantity), "1");
      assert.equal(order.status, "ACTIVE");
    }

    // User counts both as separate orders.
    assert.equal(String(snap.entity("User", sellerAddr)?.orderCount), "2");
    assert.equal(String(snap.entity("User", sellerAddr)?.activeOrderCount), "2");
  });
});
