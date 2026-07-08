import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read, type EntityFields } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { pointerId } from "./helpers.ts";

const conn = await network.getOrCreate();

describe("rewiring exit: B exits, seller A rewired to C", () => {
  after(() => conn.matchstick.reset());

  it("keeps A netQty unchanged while B exits and C enters", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, buyer2: partC, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const price2 = price - config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });
    await collateralVault.write.deposit([margin], { account: partC.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Open lot_1: A sells, B buys.
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partA.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: partB.account,
    });
    const openTxHash = buyTx.toLowerCase();
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [lotCreated] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const oldLotId = lotCreated.args.lotId.toLowerCase() as `0x${string}`;

    // Rewiring: C rests buy with a destURL so the taker-first / maker-fallback path
    // on the new lot is exercised (B's taker order carries no destURL).
    await futures.write.createOrder([price2, deliveryDate, "rewire-dst", 1], {
      account: partC.account,
    });
    const exitTx = await futures.write.createOrder([price2, deliveryDate, "", -1], {
      account: partB.account,
    });
    const exitTxHash = exitTx.toLowerCase();
    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTx });
    const [transferred] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "LotTransferred",
    });
    assert.ok(transferred, "LotTransferred must be emitted on rewiring");
    assert.equal(transferred.args.oldLotId.toLowerCase(), oldLotId);
    assert.equal(
      transferred.args.exitingParticipant.toLowerCase(),
      partB.account.address.toLowerCase(),
    );
    assert.equal(transferred.args.newParticipant.toLowerCase(), partC.account.address.toLowerCase());
    const newLotId = transferred.args.newLotId.toLowerCase() as `0x${string}`;
    const newMakerOrderId = transferred.args.makerOrderId.toLowerCase() as `0x${string}`;
    const newTakerOrderId = transferred.args.takerOrderId.toLowerCase() as `0x${string}`;
    const expectedExitPnl = transferred.args.exitPnl;

    const partAAddr = partA.account.address.toLowerCase() as `0x${string}`;
    const partBAddr = partB.account.address.toLowerCase() as `0x${string}`;
    const partCAddr = partC.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(partA.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(partC.account.address, deliveryDate)),
      read("Lot", oldLotId),
      read("Lot", newLotId),
      read("User", partAAddr),
      read("User", partBAddr),
      read("User", partCAddr),
    ]);

    // Core invariant: remaining party A does not flicker and stays at -1.
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partA.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "-1",
    );
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "0",
    );
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partC.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "1",
    );

    const oldLot = snap.entity("Lot", oldLotId);
    assert.ok(oldLot);
    assert.equal(oldLot.status, "REPLACED");
    assert.equal(oldLot.isClosed, true, "old lot must be marked closed when replaced");
    assert.ok(BigInt(String(oldLot.closedAt)) > 0n, "old lot must have a closedAt timestamp");
    assert.ok(
      typeof oldLot.closeTransactionHash === "string" &&
        (oldLot.closeTransactionHash as string).startsWith("0x"),
      "old lot's closeTransactionHash must be a hex string (matchstick uses a mock tx hash)",
    );

    const newLot = snap.entity("Lot", newLotId);
    assert.ok(newLot);
    assert.equal(newLot.status, "OPEN");
    assert.equal(newLot.isClosed, false);
    // Asymmetric prices: A is rewired through the new lot at their ORIGINAL
    // entry price (`price`) so their cost basis carries forward — the rewire
    // realizes PnL on B, not A. C enters fresh at the new match price (`price2`).
    assert.equal(newLot.sellPricePerDay, price.toString());
    assert.equal(newLot.buyPricePerDay, price2.toString());
    assert.equal(newLot.makerOrderId, newMakerOrderId);
    assert.equal(newLot.takerOrderId, newTakerOrderId);
    assert.equal(
      newLot.destURL,
      "rewire-dst",
      "B's taker order has no destURL, so newLot.destURL falls back to C's maker entry",
    );

    // Exit / open leg accounting: A is untouched, B exits with realized PnL,
    // C opens a fresh fill for the new lot.
    const userA = snap.entity("User", partAAddr);
    const userB = snap.entity("User", partBAddr);
    const userC = snap.entity("User", partCAddr);
    assert.ok(userA);
    assert.ok(userB);
    assert.ok(userC);

    assert.deepEqual(
      userA.lots,
      [oldLotId, newLotId],
      "remaining party (A) keeps the original lot and gets appended on rewire",
    );
    assert.deepEqual(userB.lots, [oldLotId], "exiting party (B) is not re-added to the new lot");
    assert.deepEqual(userC.lots, [newLotId], "entrant (C) only sees the new lot");

    assert.equal(String(userA.fillCount), "1", "A was not touched by the rewire fill leg");
    assert.equal(
      String(userB.fillCount),
      "2",
      "B has an open Fill (lot_1) plus an exit Fill (rewire)",
    );
    assert.equal(String(userC.fillCount), "1", "C only has the open fill into the new lot");

    assert.equal(
      String(userB.realizedPnl),
      String(expectedExitPnl),
      "B's realizedPnl must equal the on-chain exitPnl",
    );
    assert.equal(String(userA.realizedPnl), "0", "A's PnL does not change on a rewire");
    assert.equal(String(userC.realizedPnl), "0", "C's PnL does not change on a fresh open");

    const bFills = snap
      .saved("Fill")
      .filter((f: EntityFields) => String(f.user).toLowerCase() === partBAddr);
    assert.equal(bFills.length, 2, "B has one open Fill and one exit Fill");

    const bOpenFill = bFills.find((f: EntityFields) => String(f.fillQuantity) === "1");
    const bExitFill = bFills.find((f: EntityFields) => String(f.fillQuantity) === "-1");
    assert.ok(bOpenFill, "B has an open Fill with quantity +1");
    assert.ok(bExitFill, "B has an exit Fill with quantity -1");
    assert.equal(
      String(bOpenFill.realizedPnl),
      "0",
      "B's open Fill carries no realized PnL (PnL realizes on exit)",
    );
    assert.equal(
      String(bExitFill.realizedPnl),
      String(expectedExitPnl),
      "B's exit Fill carries the realized exitPnl",
    );
    assert.equal(
      String(bExitFill.netQuantityAfter),
      "0",
      "B's net qty after the exit leg is 0",
    );

    const cOpenFills = snap
      .saved("Fill")
      .filter((f: EntityFields) => String(f.user).toLowerCase() === partCAddr);
    assert.equal(cOpenFills.length, 1, "C has exactly one open fill from the rewire tx");
    assert.equal(String(cOpenFills[0].fillQuantity), "1");
    assert.equal(String(cOpenFills[0].netQuantityAfter), "1");
    assert.equal(String(cOpenFills[0].realizedPnl), "0", "C's open fill has no realized PnL");

    // Trade / Fill prices across open-tx (price) and rewire-exit tx (price2).
    // Locks in the qty-weighted average path in `upsertFill`: with one fill
    // per Trade per side, both Trade.tradePrice and Fill.fillPrice must equal
    // the match price of the tx that produced them.
    assert.equal(
      String(bOpenFill.fillPrice),
      price.toString(),
      "B's open Fill.fillPrice equals the entry match price",
    );
    assert.equal(
      String(bExitFill.fillPrice),
      price2.toString(),
      "B's exit Fill.fillPrice equals the rewire match price (different from entry)",
    );
    assert.equal(
      String(cOpenFills[0].fillPrice),
      price2.toString(),
      "C's open Fill.fillPrice equals the rewire match price",
    );

    const allTrades = snap.saved("Trade");
    const bTrades = allTrades.filter(
      (t: EntityFields) => String(t.user).toLowerCase() === partBAddr,
    );
    assert.equal(bTrades.length, 2, "B has one Trade per tx (open + rewire exit)");

    const bOpenTrade = bTrades.find(
      (t: EntityFields) => String(t.transactionHash).toLowerCase() === openTxHash,
    );
    const bExitTrade = bTrades.find(
      (t: EntityFields) => String(t.transactionHash).toLowerCase() === exitTxHash,
    );
    assert.ok(bOpenTrade, "B has a Trade row for the open tx");
    assert.ok(bExitTrade, "B has a Trade row for the rewire-exit tx");

    assert.equal(
      String(bOpenTrade.tradePrice),
      price.toString(),
      "B's open Trade.tradePrice equals the entry match price",
    );
    assert.equal(String(bOpenTrade.tradeQuantity), "1");
    assert.equal(String(bOpenTrade.realizedPnl), "0", "B's open Trade carries no realized PnL");

    assert.equal(
      String(bExitTrade.tradePrice),
      price2.toString(),
      "B's exit Trade.tradePrice equals the rewire match price (different from entry)",
    );
    assert.equal(String(bExitTrade.tradeQuantity), "-1");
    assert.equal(
      String(bExitTrade.realizedPnl),
      String(expectedExitPnl),
      "B's exit Trade.realizedPnl mirrors the on-chain exitPnl",
    );
    assert.equal(String(bExitTrade.netQuantityAfter), "0");

    const cTrades = allTrades.filter(
      (t: EntityFields) => String(t.user).toLowerCase() === partCAddr,
    );
    assert.equal(cTrades.length, 1, "C only has one Trade (open via rewire)");
    assert.equal(
      String(cTrades[0].tradePrice),
      price2.toString(),
      "C's Trade.tradePrice equals the rewire match price",
    );
    assert.equal(String(cTrades[0].tradeQuantity), "1");
    assert.equal(String(cTrades[0].realizedPnl), "0", "C's open Trade carries no realized PnL");

    const aTrades = allTrades.filter(
      (t: EntityFields) => String(t.user).toLowerCase() === partAAddr,
    );
    assert.equal(
      aTrades.length,
      1,
      "A only has the original open Trade — rewire does not touch A's books",
    );
    assert.equal(
      String(aTrades[0].tradePrice),
      price.toString(),
      "A's Trade.tradePrice carries forward at the original entry price on rewire",
    );
    assert.equal(String(aTrades[0].tradeQuantity), "-1");
    assert.equal(String(aTrades[0].realizedPnl), "0");

    // ============================================================
    // Field-coverage assertions: PositionSession, pointer, Trade, Fill, Lot.
    // Locks in every actively-maintained field that wasn't previously
    // covered by an integration test (see plan Phase A).
    // ============================================================

    // --- PositionSession economics ---
    const allSessions = snap.saved("PositionSession");
    const aSession = allSessions.find(
      (s: EntityFields) => String(s.user).toLowerCase() === partAAddr,
    );
    const bSession = allSessions.find(
      (s: EntityFields) => String(s.user).toLowerCase() === partBAddr,
    );
    const cSession = allSessions.find(
      (s: EntityFields) => String(s.user).toLowerCase() === partCAddr,
    );
    assert.ok(aSession, "A has a PositionSession (still open after rewire)");
    assert.ok(bSession, "B has a PositionSession (closed by rewire)");
    assert.ok(cSession, "C has a fresh PositionSession (opened by rewire)");

    // A keeps the original session at -1 → still OPEN, no closes.
    assert.equal(aSession.status, "OPEN");
    assert.equal(String(aSession.entryPrice), price.toString());
    assert.equal(String(aSession.closePrice), "0", "A has no close legs yet");
    assert.equal(String(aSession.netQuantity), "-1");
    assert.equal(String(aSession.closedQuantity), "0");
    assert.equal(String(aSession.maxQuantity), "1");
    assert.equal(String(aSession.realizedPnl), "0");
    assert.equal(String(aSession.deliveryAt), deliveryDate.toString());
    assert.ok(BigInt(String(aSession.openedAt)) > 0n);
    assert.ok(BigInt(String(aSession.lastTradeAt)) > 0n);

    // B opened at price, closed at price2 → CLOSE, closedQuantity=1.
    assert.equal(bSession.status, "CLOSE");
    assert.equal(String(bSession.entryPrice), price.toString());
    assert.equal(
      String(bSession.closePrice),
      price2.toString(),
      "B's PositionSession.closePrice = qty-weighted exit price (single leg = price2)",
    );
    assert.equal(String(bSession.netQuantity), "0");
    assert.equal(String(bSession.closedQuantity), "1");
    assert.equal(String(bSession.maxQuantity), "1");
    assert.equal(
      String(bSession.realizedPnl),
      String(expectedExitPnl),
      "B's PositionSession.realizedPnl mirrors the on-chain exitPnl",
    );
    assert.equal(String(bSession.deliveryAt), deliveryDate.toString());
    assert.ok(BigInt(String(bSession.openedAt)) > 0n);
    assert.ok(
      BigInt(String(bSession.lastTradeAt)) >= BigInt(String(bSession.openedAt)),
      "lastTradeAt must be >= openedAt",
    );

    // C just opened at price2 → OPEN, no closes.
    assert.equal(cSession.status, "OPEN");
    assert.equal(String(cSession.entryPrice), price2.toString());
    assert.equal(String(cSession.closePrice), "0");
    assert.equal(String(cSession.netQuantity), "1");
    assert.equal(String(cSession.closedQuantity), "0");
    assert.equal(String(cSession.maxQuantity), "1");
    assert.equal(String(cSession.realizedPnl), "0");
    assert.equal(String(cSession.deliveryAt), deliveryDate.toString());

    // --- UserDeliverySessionPointer.aggregatedEntryPrice ---
    const aPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(partA.account.address, deliveryDate),
    );
    const bPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(partB.account.address, deliveryDate),
    );
    const cPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(partC.account.address, deliveryDate),
    );
    assert.ok(aPtr);
    assert.ok(bPtr);
    assert.ok(cPtr);
    assert.equal(
      String(aPtr.aggregatedEntryPrice),
      price.toString(),
      "A's pointer.aggregatedEntryPrice carries the original entry price",
    );
    assert.equal(
      String(bPtr.aggregatedEntryPrice),
      "0",
      "B's pointer.aggregatedEntryPrice is zeroed once they go flat",
    );
    assert.equal(
      String(cPtr.aggregatedEntryPrice),
      price2.toString(),
      "C's pointer.aggregatedEntryPrice = rewire match price",
    );

    // --- Trade: user / positionSession / deliveryAt / fillCount / timestamp ---
    for (const t of [bOpenTrade, bExitTrade, cTrades[0], aTrades[0]]) {
      assert.ok(t);
      assert.equal(String(t.deliveryAt), deliveryDate.toString(), "Trade.deliveryAt");
      assert.equal(String(t.fillCount), "1", "Trade.fillCount = 1 (single fill per tx per user)");
      assert.ok(BigInt(String(t.timestamp)) > 0n, "Trade.timestamp from event.block.timestamp");
      assert.ok(
        typeof t.positionSession === "string" && (t.positionSession as string).length > 0,
        "Trade.positionSession references the session id (non-empty string)",
      );
    }
    assert.equal(
      String(bOpenTrade?.user).toLowerCase(),
      partBAddr,
      "Trade.user = the trading EOA",
    );
    assert.equal(String(cTrades[0].user).toLowerCase(), partCAddr);
    assert.equal(String(aTrades[0].user).toLowerCase(), partAAddr);

    // bOpenTrade and bExitTrade are in different sessions (B closed, then would
    // re-open if traded again — here they're the SAME session because B only
    // had one open→close cycle).
    assert.equal(
      String(bOpenTrade?.positionSession),
      String(bSession.id),
      "B's open Trade points at B's session",
    );
    assert.equal(
      String(bExitTrade?.positionSession),
      String(bSession.id),
      "B's exit Trade also points at B's (now-closed) session",
    );

    // --- Fill: id / trade / positionSession / deliveryAt / blockNumber / timestamp ---
    for (const f of [bOpenFill, bExitFill, cOpenFills[0]]) {
      assert.ok(f);
      assert.ok(
        typeof f.id === "string" && (f.id as string).startsWith("0x"),
        "Fill.id is composite Bytes (tx hash ++ user ++ counterparty ++ sessionId)",
      );
      assert.equal(String(f.deliveryAt), deliveryDate.toString());
      assert.ok(BigInt(String(f.blockNumber)) > 0n);
      assert.ok(BigInt(String(f.timestamp)) > 0n);
      assert.ok(
        typeof f.positionSession === "string" && (f.positionSession as string).length > 0,
      );
    }
    assert.equal(
      String(bOpenFill.trade).toLowerCase(),
      String(bOpenTrade?.id).toLowerCase(),
      "Fill.trade points at the per-(tx, user, session) Trade aggregate",
    );
    assert.equal(
      String(bExitFill.trade).toLowerCase(),
      String(bExitTrade?.id).toLowerCase(),
    );
    assert.equal(
      String(cOpenFills[0].trade).toLowerCase(),
      String(cTrades[0].id).toLowerCase(),
    );

    // --- Lot: id / seller / buyer / deliveryAt / blockNumber ---
    // (Lot status / pricing / close metadata are asserted earlier in the test.)
    const oldLotForFields = snap.entity("Lot", oldLotId);
    const newLotForFields = snap.entity("Lot", newLotId);
    assert.ok(oldLotForFields);
    assert.ok(newLotForFields);
    assert.equal(String(oldLotForFields.id).toLowerCase(), oldLotId, "Lot.id = on-chain lotId");
    assert.equal(String(newLotForFields.id).toLowerCase(), newLotId);
    assert.equal(
      String(oldLotForFields.seller).toLowerCase(),
      partAAddr,
      "Old lot's seller is A (the original maker)",
    );
    assert.equal(
      String(oldLotForFields.buyer).toLowerCase(),
      partBAddr,
      "Old lot's buyer is B (the original taker)",
    );
    assert.equal(
      String(newLotForFields.seller).toLowerCase(),
      partAAddr,
      "Rewire keeps A as the remaining seller in the new lot",
    );
    assert.equal(
      String(newLotForFields.buyer).toLowerCase(),
      partCAddr,
      "Rewire makes C the new buyer",
    );
    assert.equal(String(oldLotForFields.deliveryAt), deliveryDate.toString());
    assert.equal(String(newLotForFields.deliveryAt), deliveryDate.toString());
    assert.ok(BigInt(String(oldLotForFields.blockNumber)) > 0n);
    assert.ok(BigInt(String(newLotForFields.blockNumber)) > 0n);
  });
});

describe("mutual exit: A and B both go flat", () => {
  after(() => conn.matchstick.reset());

  it("emits LotClosed(MUTUAL_EXIT) and zeroes both pointers", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const price2 = price - config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partA.account });
    const openTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: partB.account,
    });
    const openReceipt = await pc.waitForTransactionReceipt({ hash: openTx });
    const [opened] = parseEventLogs({
      logs: openReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lotId = opened.args.lotId.toLowerCase() as `0x${string}`;

    // Mutual exit path: B sells resting, A buys taker.
    await futures.write.createOrder([price2, deliveryDate, "", -1], { account: partB.account });
    const exitTx = await futures.write.createOrder([price2, deliveryDate, "", 1], {
      account: partA.account,
    });
    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTx });
    const [closed] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });
    assert.ok(closed, "LotClosed must be emitted on mutual exit");
    assert.equal(closed.args.lotId.toLowerCase(), lotId);
    assert.equal(closed.args.reason, 0, "reason=0 => MUTUAL_EXIT");
    const expectedSellerPnl = closed.args.sellerPnl;
    const expectedBuyerPnl = closed.args.buyerPnl;
    const expectedClosedBy = closed.args.closedBy.toLowerCase() as `0x${string}`;

    const partAAddr = partA.account.address.toLowerCase() as `0x${string}`;
    const partBAddr = partB.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(partA.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate)),
      read("Lot", lotId),
      read("User", partAAddr),
      read("User", partBAddr),
    ]);
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partA.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "0",
    );
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "0",
    );

    const lot = snap.entity("Lot", lotId);
    assert.ok(lot);
    assert.equal(lot.status, "CLOSED");
    assert.equal(lot.closeReason, "MUTUAL_EXIT");
    assert.equal(lot.isClosed, true);
    assert.equal(String(lot.sellerPnl), String(expectedSellerPnl));
    assert.equal(String(lot.buyerPnl), String(expectedBuyerPnl));
    assert.equal(String(lot.closedBy).toLowerCase(), expectedClosedBy);
    assert.ok(BigInt(String(lot.closedAt)) > 0n, "Lot.closedAt must be set on mutual exit");
    assert.ok(
      typeof lot.closeTransactionHash === "string" &&
        (lot.closeTransactionHash as string).startsWith("0x"),
      "Lot.closeTransactionHash must be a hex string (matchstick uses a mock tx hash)",
    );

    // Append-only User.lots: closed lots remain in each participant's history.
    const userA = snap.entity("User", partAAddr);
    const userB = snap.entity("User", partBAddr);
    assert.ok(userA);
    assert.ok(userB);
    assert.deepEqual(
      userA.lots,
      [lotId],
      "seller's User.lots still references the closed lot (append-only history)",
    );
    assert.deepEqual(
      userB.lots,
      [lotId],
      "buyer's User.lots still references the closed lot (append-only history)",
    );
    assert.equal(
      String(userA.realizedPnl),
      String(expectedSellerPnl),
      "seller User.realizedPnl must equal the on-chain sellerPnl",
    );
    assert.equal(
      String(userB.realizedPnl),
      String(expectedBuyerPnl),
      "buyer User.realizedPnl must equal the on-chain buyerPnl",
    );
  });
});

// `LotClosed` does not emit the exit match price — only PnL — so
// `handleLotClosed` must back-derive it from `sellerPnl` / `buyerPnl` and the
// carried-over entry price via `derivePriceFromExit`. Without that derivation,
// the close-leg Fill.fillPrice / Trade.tradePrice would mirror entry while the
// same row's realizedPnl reflects the exit, leaving (price, pnl) internally
// inconsistent.
describe("mutual exit: close-leg Trade/Fill prices reflect the EXIT price", () => {
  after(() => conn.matchstick.reset());

  it("Fill.fillPrice and Trade.tradePrice on the close leg equal price2, not entry price", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const price2 = price - config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partA.account });
    const openTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: partB.account,
    });
    const openTxHash = openTx.toLowerCase();

    await futures.write.createOrder([price2, deliveryDate, "", -1], { account: partB.account });
    const exitTx = await futures.write.createOrder([price2, deliveryDate, "", 1], {
      account: partA.account,
    });
    const exitTxHash = exitTx.toLowerCase();
    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTx });
    const [closed] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });
    const expectedSellerPnl = closed.args.sellerPnl;
    const expectedBuyerPnl = closed.args.buyerPnl;

    const partAAddr = partA.account.address.toLowerCase() as `0x${string}`;
    const partBAddr = partB.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("User", partAAddr),
      read("User", partBAddr),
    ]);

    // Sanity: confirm the realizedPnl wiring is consistent — one unit settles `pricePerDay`
    // (no duration multiplier), so PnL must equal the entry-exit price delta directly. If this
    // fails, the fixture/setup drifted and the price assertions below are meaningless.
    assert.equal(
      expectedSellerPnl,
      price - price2,
      "seller PnL should equal entry - exit price delta",
    );

    const allTrades = snap.saved("Trade");
    const allFills = snap.saved("Fill");

    // === A (seller): open at `price`, close at `price2`. ===
    const aTrades = allTrades.filter(
      (t: EntityFields) => String(t.user).toLowerCase() === partAAddr,
    );
    assert.equal(aTrades.length, 2, "A has one Trade per tx (open + mutual exit)");

    const aOpenTrade = aTrades.find(
      (t: EntityFields) => String(t.transactionHash).toLowerCase() === openTxHash,
    );
    const aExitTrade = aTrades.find(
      (t: EntityFields) => String(t.transactionHash).toLowerCase() === exitTxHash,
    );
    assert.ok(aOpenTrade);
    assert.ok(aExitTrade);

    assert.equal(String(aOpenTrade.tradePrice), price.toString());
    assert.equal(String(aOpenTrade.tradeQuantity), "-1");
    assert.equal(String(aOpenTrade.realizedPnl), "0");

    assert.equal(
      String(aExitTrade.tradePrice),
      price2.toString(),
      "A's close-leg Trade.tradePrice must equal the exit match price (price2), " +
        "not the carried-over entry price",
    );
    assert.equal(String(aExitTrade.tradeQuantity), "1");
    assert.equal(String(aExitTrade.realizedPnl), String(expectedSellerPnl));

    // === B (buyer): mirror. ===
    const bTrades = allTrades.filter(
      (t: EntityFields) => String(t.user).toLowerCase() === partBAddr,
    );
    assert.equal(bTrades.length, 2);

    const bOpenTrade = bTrades.find(
      (t: EntityFields) => String(t.transactionHash).toLowerCase() === openTxHash,
    );
    const bExitTrade = bTrades.find(
      (t: EntityFields) => String(t.transactionHash).toLowerCase() === exitTxHash,
    );
    assert.ok(bOpenTrade);
    assert.ok(bExitTrade);

    assert.equal(String(bOpenTrade.tradePrice), price.toString());
    assert.equal(String(bOpenTrade.tradeQuantity), "1");
    assert.equal(String(bOpenTrade.realizedPnl), "0");

    assert.equal(
      String(bExitTrade.tradePrice),
      price2.toString(),
      "B's close-leg Trade.tradePrice must equal the exit match price (price2), " +
        "not the carried-over entry price",
    );
    assert.equal(String(bExitTrade.tradeQuantity), "-1");
    assert.equal(String(bExitTrade.realizedPnl), String(expectedBuyerPnl));

    // === Fill rows mirror Trade aggregates (single fill per tx per side). ===
    const aExitFill = allFills.find(
      (f: EntityFields) =>
        String(f.user).toLowerCase() === partAAddr &&
        String(f.transactionHash).toLowerCase() === exitTxHash,
    );
    const bExitFill = allFills.find(
      (f: EntityFields) =>
        String(f.user).toLowerCase() === partBAddr &&
        String(f.transactionHash).toLowerCase() === exitTxHash,
    );
    assert.ok(aExitFill);
    assert.ok(bExitFill);
    assert.equal(
      String(aExitFill.fillPrice),
      price2.toString(),
      "A's close-leg Fill.fillPrice must equal the exit match price (price2)",
    );
    assert.equal(
      String(bExitFill.fillPrice),
      price2.toString(),
      "B's close-leg Fill.fillPrice must equal the exit match price (price2)",
    );
  });
});

// `Trade.fillCount` only increments when a NEW `Fill` row is created — so
// hitting `fillCount=2` requires two DISTINCT counterparties in the same tx
// (one Fill row per (tx, user, counterparty, session)). This exercises that
// path: B opens qty=+2 against two different sellers A and C at the same
// price, then mutual-exits qty=2 against A+C buying back in one tx. Both
// close legs land on B's exit Trade as two separate Fills, aggregating to
// the qty-weighted (uniform) close price.
describe("multi-counterparty exit aggregation: Trade.fillCount=2 across 2 Fills", () => {
  after(() => conn.matchstick.reset());

  it("qty=2 mutual exit at uniform price2 aggregates two Fills into one Trade per user", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, buyer2: partC, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const price2 = price - config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });
    await collateralVault.write.deposit([margin], { account: partC.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // --- Open phase: B buys qty=2 against two distinct sellers A and C. ---
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partA.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partC.account });
    const openTx = await futures.write.createOrder([price, deliveryDate, "dst", 2], {
      account: partB.account,
    });
    const openTxHash = openTx.toLowerCase();
    const openReceipt = await pc.waitForTransactionReceipt({ hash: openTx });
    const openLots = parseEventLogs({
      logs: openReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    assert.equal(openLots.length, 2, "qty=2 buy against 2 resting sellers must open 2 lots");

    // --- Mutual-exit phase: A and C rest buys at price2, B sells qty=2 taker. ---
    await futures.write.createOrder([price2, deliveryDate, "", 1], { account: partA.account });
    await futures.write.createOrder([price2, deliveryDate, "", 1], { account: partC.account });
    const exitTx = await futures.write.createOrder([price2, deliveryDate, "", -2], {
      account: partB.account,
    });
    const exitTxHash = exitTx.toLowerCase();
    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTx });
    const closedEvents = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });
    assert.equal(closedEvents.length, 2, "qty=2 taker exit must produce 2 LotClosed events");
    for (const e of closedEvents) assert.equal(e.args.reason, 0, "reason=0 => MUTUAL_EXIT");
    const sumBuyerPnl =
      closedEvents[0].args.buyerPnl + closedEvents[1].args.buyerPnl;
    const sumSellerPnl =
      closedEvents[0].args.sellerPnl + closedEvents[1].args.sellerPnl;

    const partAAddr = partA.account.address.toLowerCase() as `0x${string}`;
    const partBAddr = partB.account.address.toLowerCase() as `0x${string}`;
    const partCAddr = partC.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate)),
    ]);

    // --- B's pointer goes flat. ---
    const bPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(partB.account.address, deliveryDate),
    );
    assert.ok(bPtr);
    assert.equal(String(bPtr.netQuantity), "0", "B is flat after qty=2 mutual exit");
    assert.equal(String(bPtr.aggregatedEntryPrice), "0", "pointer.aggregatedEntryPrice zeroed");

    // --- B's exit Trade aggregates two Fills (A and C as counterparties). ---
    const allTrades = snap.saved("Trade");
    const bExitTrade = allTrades.find(
      (t: EntityFields) =>
        String(t.user).toLowerCase() === partBAddr &&
        String(t.transactionHash).toLowerCase() === exitTxHash,
    );
    assert.ok(bExitTrade, "B has one exit Trade aggregating both lots");
    assert.equal(
      String(bExitTrade.fillCount),
      "2",
      "Trade.fillCount = 2 — one Fill row per (tx, user, counterparty, session)",
    );
    assert.equal(String(bExitTrade.tradeQuantity), "-2", "Trade.tradeQuantity = -2 (signed sum)");
    assert.equal(
      String(bExitTrade.tradePrice),
      price2.toString(),
      "Trade.tradePrice = qty-weighted exit price (uniform → price2)",
    );
    assert.equal(
      String(bExitTrade.realizedPnl),
      String(sumBuyerPnl),
      "Trade.realizedPnl = sum of per-leg buyer PnL",
    );
    assert.equal(String(bExitTrade.netQuantityAfter), "0", "Trade.netQuantityAfter = 0 (flat)");

    // B's open Trade is in the OPEN tx — must also aggregate two Fills (A, C
    // are distinct counterparties on the open side as well).
    const bOpenTrade = allTrades.find(
      (t: EntityFields) =>
        String(t.user).toLowerCase() === partBAddr &&
        String(t.transactionHash).toLowerCase() === openTxHash,
    );
    assert.ok(bOpenTrade);
    assert.equal(
      String(bOpenTrade.fillCount),
      "2",
      "B's open Trade also has fillCount=2 (qty=2 against 2 distinct sellers)",
    );
    assert.equal(String(bOpenTrade.tradeQuantity), "2");
    assert.equal(String(bOpenTrade.tradePrice), price.toString());

    // --- Two distinct Fill rows for B in the exit tx, keyed by counterparty. ---
    const bExitFills = snap
      .saved("Fill")
      .filter(
        (f: EntityFields) =>
          String(f.user).toLowerCase() === partBAddr &&
          String(f.transactionHash).toLowerCase() === exitTxHash,
      );
    assert.equal(bExitFills.length, 2, "B's exit produces 2 Fill rows (A and C as counterparties)");
    const counterparties = new Set(
      bExitFills.map((f: EntityFields) => String(f.counterparty).toLowerCase()),
    );
    assert.deepEqual(
      [...counterparties].sort(),
      [partAAddr, partCAddr].sort(),
      "Fill.counterparty set = {A, C}",
    );
    for (const f of bExitFills) {
      assert.equal(String(f.fillQuantity), "-1", "each leg is qty=-1");
      assert.equal(String(f.fillPrice), price2.toString(), "each leg fills at price2");
      assert.equal(String(f.trade).toLowerCase(), String(bExitTrade.id).toLowerCase());
    }

    // --- B's PositionSession closes with qty-weighted close price + sum PnL. ---
    const bSessions = snap
      .saved("PositionSession")
      .filter((s: EntityFields) => String(s.user).toLowerCase() === partBAddr);
    assert.equal(bSessions.length, 1, "single session spans both open + both close legs");
    const bSession = bSessions[0];
    assert.equal(bSession.status, "CLOSE");
    assert.equal(String(bSession.entryPrice), price.toString());
    assert.equal(
      String(bSession.closePrice),
      price2.toString(),
      "PositionSession.closePrice = qty-weighted close price (uniform → price2)",
    );
    assert.equal(String(bSession.closedQuantity), "2", "PositionSession.closedQuantity = 2");
    assert.equal(String(bSession.maxQuantity), "2", "PositionSession.maxQuantity = 2 at peak");
    assert.equal(
      String(bSession.realizedPnl),
      String(sumBuyerPnl),
      "PositionSession.realizedPnl = sum of per-leg buyer PnL",
    );

    // --- Symmetric checks for A and C: each has their own exit Trade w/ fillCount=1. ---
    for (const [user, expectedSum] of [
      [partAAddr, closedEvents[0].args.sellerPnl] as const,
      [partCAddr, closedEvents[1].args.sellerPnl] as const,
    ]) {
      const exitTrade = allTrades.find(
        (t: EntityFields) =>
          String(t.user).toLowerCase() === user &&
          String(t.transactionHash).toLowerCase() === exitTxHash,
      );
      assert.ok(exitTrade, `${user} has an exit Trade in the mutual-exit tx`);
      assert.equal(
        String(exitTrade.fillCount),
        "1",
        `${user} has only one counterparty (B) → fillCount=1`,
      );
      assert.equal(String(exitTrade.tradeQuantity), "1", `${user} closes their -1 short via +1`);
      assert.equal(String(exitTrade.tradePrice), price2.toString());
      assert.ok(
        BigInt(String(exitTrade.realizedPnl)) === expectedSum,
        `${user} realizedPnl = the on-chain LotClosed.sellerPnl for their lot`,
      );
    }

    // Sanity: futures totals match the produced rows.
    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(
      String(futuresEntity.totalFills),
      "8",
      // open tx: 4 Fill rows = {B↔A, B↔C, A↔B, C↔B}; exit tx mirrors → another 4.
      "totalFills = 8 (4 per tx: one Fill per (tx, user, counterparty, session))",
    );

    // Sanity sum: PnL conservation across both sides.
    assert.equal(
      sumBuyerPnl + sumSellerPnl,
      0n,
      "buyer+seller PnL across both lots must sum to zero by contract design",
    );
  });
});
