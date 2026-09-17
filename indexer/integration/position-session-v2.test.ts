import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { pointerId } from "./helpers.ts";
import { TimeInForce } from "../../contracts/tests/timeInForce.ts";

const conn = await network.getOrCreate();

describe("single match session state", () => {
  after(() => conn.matchstick.reset());

  it("creates two per-user fills and +/-1 netQty pointers", async () => {
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

    const sellTx = await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const sellReceipt = await pc.waitForTransactionReceipt({ hash: sellTx });
    const [makerOrderCreated] = parseEventLogs({
      logs: sellReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const buyTx = await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [orderMatched] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.ok(orderMatched, "OrderMatched must fire");
    const makerOrderId = orderMatched.args.makerOrderId.toLowerCase() as `0x${string}`;
    assert.equal(
      makerOrderId,
      makerOrderCreated.args.orderId.toLowerCase(),
      "OrderMatched.makerOrderId must match seller's resting OrderCreated.orderId",
    );

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;
    const sellerPtrId = pointerId(seller.account.address, deliveryDate);
    const buyerPtrId = pointerId(buyer.account.address, deliveryDate);
    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", sellerPtrId),
      read("UserDeliverySessionPointer", buyerPtrId),
      read("User", sellerAddr),
      read("User", buyerAddr),
      read("Futures", "0"),
    ]);

    assert.equal(String(snap.entity("UserDeliverySessionPointer", sellerPtrId)?.netQuantity), "-1");
    assert.equal(String(snap.entity("UserDeliverySessionPointer", buyerPtrId)?.netQuantity), "1");

    const sessions = snap.saved("PositionSession");
    assert.equal(sessions.length, 2, "one OPEN session per side after a match");
    const sellerSession = sessions.find((s) => String(s.user).toLowerCase() === sellerAddr);
    const buyerSession = sessions.find((s) => String(s.user).toLowerCase() === buyerAddr);
    assert.ok(sellerSession);
    assert.ok(buyerSession);
    assert.equal(sellerSession.status, "OPEN");
    assert.equal(buyerSession.status, "OPEN");

    const fills = snap.saved("Fill");
    assert.equal(fills.length, 2, "per-user model: one fill for seller and one for buyer");
    const sellerFill = fills.find((f) => String(f.fillQuantity) === "-1");
    const buyerFill = fills.find((f) => String(f.fillQuantity) === "1");
    assert.ok(sellerFill);
    assert.ok(buyerFill);
    assert.equal(sellerFill.fillPrice, price.toString());
    assert.equal(buyerFill.fillPrice, price.toString());

    const trades = snap.saved("Trade");
    assert.equal(trades.length, 2, "one trade per participant");

    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(String(futuresEntity.totalFills), "2");
    assert.equal(String(futuresEntity.totalTrades), "2");

    const sellerUser = snap.entity("User", sellerAddr);
    const buyerUser = snap.entity("User", buyerAddr);
    assert.ok(sellerUser);
    assert.ok(buyerUser);
    assert.equal(String(sellerUser.fillCount), "1", "seller has one aggregated fill row");
    assert.equal(String(sellerUser.tradeCount), "1", "seller has one aggregated trade row");
    assert.equal(String(buyerUser.fillCount), "1");
    assert.equal(String(buyerUser.tradeCount), "1");
  });
});

describe("same tx qty=3 aggregation", () => {
  after(() => conn.matchstick.reset());

  it("aggregates fills per user into qty=-3 and qty=+3", async () => {
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

    await futures.write.createOrder([price, deliveryDate, -3n, TimeInForce.GTC], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, 3n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const matched = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matched.length, 1, "qty=3 match emits one OrderMatched");

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;
    const sellerPtrId = pointerId(seller.account.address, deliveryDate);
    const buyerPtrId = pointerId(buyer.account.address, deliveryDate);
    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", sellerPtrId),
      read("UserDeliverySessionPointer", buyerPtrId),
      read("User", sellerAddr),
      read("User", buyerAddr),
      read("Futures", "0"),
    ]);

    assert.equal(String(snap.entity("UserDeliverySessionPointer", sellerPtrId)?.netQuantity), "-3");
    assert.equal(String(snap.entity("UserDeliverySessionPointer", buyerPtrId)?.netQuantity), "3");

    const fills = snap.saved("Fill");
    assert.equal(fills.length, 2, "per-user aggregation: one fill row per side");
    const sellerFill = fills.find((f) => String(f.fillQuantity) === "-3");
    const buyerFill = fills.find((f) => String(f.fillQuantity) === "3");
    assert.ok(sellerFill);
    assert.ok(buyerFill);
    assert.equal(sellerFill.fillPrice, price.toString());
    assert.equal(buyerFill.fillPrice, price.toString());

    const sessions = snap.saved("PositionSession");
    assert.equal(sessions.length, 2, "one session per side after aggregated match");
    for (const s of sessions) {
      assert.equal(s.status, "OPEN");
      assert.equal(String(s.maxQuantity), "3");
    }

    const sellerUser = snap.entity("User", sellerAddr);
    const buyerUser = snap.entity("User", buyerAddr);
    assert.ok(sellerUser);
    assert.ok(buyerUser);
    assert.equal(
      String(sellerUser.fillCount),
      "1",
      "qty=3 aggregates to a single Fill per user, so fillCount must remain 1",
    );
    assert.equal(String(sellerUser.tradeCount), "1");
    assert.equal(String(buyerUser.fillCount), "1");
    assert.equal(String(buyerUser.tradeCount), "1");

    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(
      String(futuresEntity.totalFills),
      "2",
      "Futures.totalFills aggregates qty=3 into two per-user Fill rows",
    );
    assert.equal(String(futuresEntity.totalTrades), "2");
  });
});

// ---------------------------------------------------------------------------
// scaling into a position at two different prices: qty-weighted entry price
// ---------------------------------------------------------------------------
describe("scaling into a position at two different prices: qty-weighted entry price", () => {
  after(() => conn.matchstick.reset());

  it("aggregatedEntryPrice + PositionSession.entryPrice = (p1+p2)/2 after two same-side fills", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const p1 = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const p2 = p1 + config.priceLadderStep;
    const expectedAvg = (p1 + p2) / 2n;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // tx1: A sells 1 at p1, B buys 1 at p1.
    await futures.write.createOrder([p1, deliveryDate, -1n, TimeInForce.GTC], { account: seller.account });
    const buy1 = await futures.write.createOrder([p1, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buy1 });

    // tx2: A sells another 1 at p2, B buys another 1 at p2.
    await futures.write.createOrder([p2, deliveryDate, -1n, TimeInForce.GTC], { account: seller.account });
    const buy2 = await futures.write.createOrder([p2, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buy2 });

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;
    const sellerPtrId = pointerId(seller.account.address, deliveryDate);
    const buyerPtrId = pointerId(buyer.account.address, deliveryDate);

    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", sellerPtrId),
      read("UserDeliverySessionPointer", buyerPtrId),
    ]);

    // --- UserDeliverySessionPointer.aggregatedEntryPrice (qty-weighted) ---
    const sellerPtr = snap.entity("UserDeliverySessionPointer", sellerPtrId);
    const buyerPtr = snap.entity("UserDeliverySessionPointer", buyerPtrId);
    assert.ok(sellerPtr);
    assert.ok(buyerPtr);
    assert.equal(String(sellerPtr.netQuantity), "-2");
    assert.equal(String(buyerPtr.netQuantity), "2");
    assert.equal(
      String(sellerPtr.aggregatedEntryPrice),
      expectedAvg.toString(),
      "seller pointer.aggregatedEntryPrice = (p1+p2)/2 (qty-weighted)",
    );
    assert.equal(
      String(buyerPtr.aggregatedEntryPrice),
      expectedAvg.toString(),
      "buyer pointer.aggregatedEntryPrice = (p1+p2)/2 (qty-weighted)",
    );

    // --- PositionSession.entryPrice: same qty-weighted aggregation ---
    const sessions = snap.saved("PositionSession");
    const sellerSession = sessions.find(
      (s) => String(s.user).toLowerCase() === sellerAddr,
    );
    const buyerSession = sessions.find(
      (s) => String(s.user).toLowerCase() === buyerAddr,
    );
    assert.ok(sellerSession, "seller has exactly one open session spanning both fills");
    assert.ok(buyerSession, "buyer has exactly one open session spanning both fills");

    assert.equal(sellerSession.status, "OPEN");
    assert.equal(buyerSession.status, "OPEN");
    assert.equal(
      String(sellerSession.entryPrice),
      expectedAvg.toString(),
      "seller PositionSession.entryPrice = qty-weighted of two open legs",
    );
    assert.equal(
      String(buyerSession.entryPrice),
      expectedAvg.toString(),
      "buyer PositionSession.entryPrice = qty-weighted of two open legs",
    );
    assert.equal(
      String(sellerSession.netQuantity),
      "-2",
      "session.netQuantity reflects the scaled-in net qty",
    );
    assert.equal(String(buyerSession.netQuantity), "2");
    assert.equal(
      String(sellerSession.maxQuantity),
      "2",
      "session.maxQuantity climbs to 2 after the second leg",
    );
    assert.equal(String(buyerSession.maxQuantity), "2");
    assert.equal(
      String(sellerSession.closedQuantity),
      "0",
      "no exits → closedQuantity stays at 0",
    );
    assert.equal(String(buyerSession.closedQuantity), "0");
    assert.equal(String(sellerSession.closePrice), "0", "no exits → closePrice stays at 0");
    assert.equal(String(buyerSession.closePrice), "0");
    assert.equal(String(sellerSession.realizedPnl), "0");
    assert.equal(String(buyerSession.realizedPnl), "0");

    // Exactly one session per user, even though two matches opened across two txs.
    const sellerSessions = sessions.filter(
      (s) => String(s.user).toLowerCase() === sellerAddr,
    );
    const buyerSessions = sessions.filter(
      (s) => String(s.user).toLowerCase() === buyerAddr,
    );
    assert.equal(sellerSessions.length, 1, "scaling in keeps the same OPEN session");
    assert.equal(buyerSessions.length, 1);
  });
});
