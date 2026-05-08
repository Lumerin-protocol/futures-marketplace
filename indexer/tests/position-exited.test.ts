import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { PositionCreated, PositionExited } from "../generated/Futures/Futures";
import {
  handlePositionCreated,
  handlePositionExited,
} from "../src/handlers/positions";
import {
  bytes32Id,
  fillAggKey,
  nudgeTx,
  nudgedTxHash,
  paramAddr,
  paramBytes,
  paramInt,
  paramString,
  paramUint,
  pointerKey,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

const DELIVERY = BigInt.fromI64(1_700_000_000);
const ENTRY_PRICE = BigInt.fromI64(1_000_000);
const DURATION_DAYS = 30;

function positionCreated(
  positionId: Bytes,
  seller: Address,
  buyer: Address,
  price: BigInt,
): PositionCreated {
  return newTypedMockEventWithParams<PositionCreated>([
    paramBytes("positionId", positionId),
    paramAddr("seller", seller),
    paramAddr("buyer", buyer),
    paramUint("sellPricePerDay", price),
    paramUint("buyPricePerDay", price),
    paramUint("deliveryAt", DELIVERY),
    paramString("destURL", "u"),
    paramBytes("orderId", bytes32Id(99)),
    paramBytes("takerOrderId", bytes32Id(98)),
  ]);
}

function positionExited(
  positionId: Bytes,
  participant: Address,
  pnl: BigInt,
): PositionExited {
  return newTypedMockEventWithParams<PositionExited>([
    paramBytes("positionId", positionId),
    paramAddr("participant", participant),
    paramInt("pnl", pnl),
  ]);
}

describe("handlePositionExited", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures(DURATION_DAYS);
  });

  test("buyer exits a long: realized pnl recorded, position marked exited, session closes", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const pid = bytes32Id(1);

    handlePositionCreated(positionCreated(pid, seller, buyer, ENTRY_PRICE));
    // Exit happens in a *later* tx — bump tx hash + block so the new Fill is distinct.
    const exitEvent = positionExited(pid, buyer, BigInt.fromI64(5_000_000 * DURATION_DAYS));
    nudgeTx(exitEvent, 2);
    const pnl = BigInt.fromI64(5_000_000 * DURATION_DAYS);
    handlePositionExited(exitEvent);

    assert.fieldEquals("Position", pid.toHexString(), "isExited", "true");
    assert.fieldEquals("Position", pid.toHexString(), "buyerExitPnl", pnl.toString());

    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "netQuantity", "0");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "currentSessionId", "");

    // Buyer's PositionSession (block=1, logIndex=1, side=1) transitions to CLOSE.
    const buyerSession = "00000000000100000101";
    const exitFillId = fillAggKey(nudgedTxHash(2), buyer, seller, buyerSession);
    assert.fieldEquals("Fill", exitFillId, "realizedPnl", pnl.toString());
    assert.fieldEquals("Fill", exitFillId, "fillQuantity", "-1");
    assert.fieldEquals("Fill", exitFillId, "netQuantityAfter", "0");

    assert.fieldEquals("User", buyer.toHexString(), "realizedPnl", pnl.toString());

    assert.fieldEquals("PositionSession", buyerSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "0");
    assert.fieldEquals("PositionSession", buyerSession, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "realizedPnl", pnl.toString());
    // Historical entryPrice must survive the close (must NOT be reset to 0).
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", ENTRY_PRICE.toString());

    assert.fieldEquals("Position", pid.toHexString(), "buyerExitFill", exitFillId);
  });

  test("seller exits a short: pnl recorded, sellerExitFill linked, session closes", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const pid = bytes32Id(1);

    handlePositionCreated(positionCreated(pid, seller, buyer, ENTRY_PRICE));
    const exitEvent = positionExited(pid, seller, BigInt.fromI64(2_000_000 * DURATION_DAYS));
    nudgeTx(exitEvent, 2);
    const pnl = BigInt.fromI64(2_000_000 * DURATION_DAYS);
    handlePositionExited(exitEvent);

    assert.fieldEquals("Position", pid.toHexString(), "isExited", "true");
    assert.fieldEquals("Position", pid.toHexString(), "sellerExitPnl", pnl.toString());

    // Historical entryPrice must survive the close (must NOT be reset to 0).
    const sellerSession = "00000000000100000100";
    const sellerExitFillId = fillAggKey(nudgedTxHash(2), seller, buyer, sellerSession);
    assert.fieldEquals("Position", pid.toHexString(), "sellerExitFill", sellerExitFillId);
    assert.fieldEquals("Fill", sellerExitFillId, "fillQuantity", "1");
    assert.fieldEquals("Fill", sellerExitFillId, "realizedPnl", pnl.toString());

    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(seller, DELIVERY), "netQuantity", "0");
    assert.fieldEquals("User", seller.toHexString(), "realizedPnl", pnl.toString());

    assert.fieldEquals("PositionSession", sellerSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", sellerSession, "entryPrice", ENTRY_PRICE.toString());
  });

  test("scale-in then full exit: closed session preserves the weighted-avg entryPrice", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    // Two opens at different prices → buyer's session has weighted-avg entry.
    const open1 = positionCreated(bytes32Id(1), seller, buyer, BigInt.fromI64(3_000_000));
    handlePositionCreated(open1);

    const open2 = positionCreated(bytes32Id(2), seller, buyer, BigInt.fromI64(4_000_000));
    nudgeTx(open2, 2);
    handlePositionCreated(open2);

    // Buyer session id is bound to block=1 / logIndex=1 / side=1 (the first open).
    const buyerSession = "00000000000100000101";
    const expectedEntry = BigInt.fromI64(3_500_000); // (3M + 4M) / 2
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", expectedEntry.toString());
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "2");

    // Exit both units → session goes flat (closedQuantity == maxQuantity).
    const exit1 = positionExited(bytes32Id(1), buyer, BigInt.fromI64(1_000_000 * DURATION_DAYS));
    nudgeTx(exit1, 3);
    handlePositionExited(exit1);

    const exit2 = positionExited(bytes32Id(2), buyer, BigInt.fromI64(1_000_000 * DURATION_DAYS));
    nudgeTx(exit2, 4);
    handlePositionExited(exit2);

    assert.fieldEquals("PositionSession", buyerSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "0");
    assert.fieldEquals("PositionSession", buyerSession, "closedQuantity", "2");
    assert.fieldEquals("PositionSession", buyerSession, "maxQuantity", "2");
    // Regression: entryPrice must NOT be reset to 0 when the session closes.
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", expectedEntry.toString());
  });

  test("asymmetric scale-in: entryPrice is correctly qty-weighted (catches swapped-weight bugs)", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    // 3 opens at 2M followed by 1 open at 10M.
    // Correct weighted-avg:   (3*2M + 1*10M) / 4 = 4M
    // Swapped-weight bug:     (1*2M + 3*10M) / 4 = 8M (would be caught by this test)
    const priceLow = BigInt.fromI64(2_000_000);
    const priceHigh = BigInt.fromI64(10_000_000);

    const a = positionCreated(bytes32Id(1), seller, buyer, priceLow);
    handlePositionCreated(a);

    const b = positionCreated(bytes32Id(2), seller, buyer, priceLow);
    nudgeTx(b, 2);
    handlePositionCreated(b);

    const c = positionCreated(bytes32Id(3), seller, buyer, priceLow);
    nudgeTx(c, 3);
    handlePositionCreated(c);

    const d = positionCreated(bytes32Id(4), seller, buyer, priceHigh);
    nudgeTx(d, 4);
    handlePositionCreated(d);

    const buyerSession = "00000000000100000101";
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "4");
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", "4000000");
  });

  test("partial close preserves entryPrice on the still-open session", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, ENTRY_PRICE));
    const open2 = positionCreated(bytes32Id(2), seller, buyer, ENTRY_PRICE);
    nudgeTx(open2, 2);
    handlePositionCreated(open2);

    // Exit only one of the two units → session stays OPEN at netQuantity=1,
    // entryPrice must remain unchanged (reduce-same-direction branch).
    const exit1 = positionExited(bytes32Id(1), buyer, BigInt.fromI64(2_000_000 * DURATION_DAYS));
    nudgeTx(exit1, 3);
    handlePositionExited(exit1);

    const buyerSession = "00000000000100000101";
    assert.fieldEquals("PositionSession", buyerSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", ENTRY_PRICE.toString());
  });

  test("break-even close (pnl=0) still bumps closedQuantity and updates closePrice", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, ENTRY_PRICE));
    const open2 = positionCreated(bytes32Id(2), seller, buyer, ENTRY_PRICE);
    nudgeTx(open2, 2);
    handlePositionCreated(open2);

    // Exit at break-even (pnl=0 → derivePriceFromExit returns entryPrice → priceDiff=0).
    // closedQuantity, closePrice, and the realizedPnl-running-sum must still update.
    const exit1 = positionExited(bytes32Id(1), buyer, BigInt.fromI64(0));
    nudgeTx(exit1, 3);
    handlePositionExited(exit1);

    const buyerSession = "00000000000100000101";
    assert.fieldEquals("PositionSession", buyerSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "closePrice", ENTRY_PRICE.toString());
    assert.fieldEquals("PositionSession", buyerSession, "realizedPnl", "0");
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", ENTRY_PRICE.toString());
  });

  test("flip in same tx: close + reopen produce two distinct Trades with consistent pnl/session", () => {
    // Regression for the user-reported "realized pnl for a new first trade after
    // a position closed is > 0 (it should be 0)" bug.
    //
    // On-chain shape (one tx, one taker order with qty>1 from user `victim`):
    //   1. PositionCreated #1 (in a prior tx) — victim built a long
    //   2. victim posts a sell qty=2; first match offsets the long:
    //      → PositionExited(participant=victim)  // closes victim's long, non-zero pnl
    //      → PositionCreated(existingSeller, taker1)  // new pos w/o victim (not exercised here)
    //   3. second match has nothing left to offset for victim → victim opens a new short:
    //      → PositionCreated(seller=victim, buyer=taker2)
    //
    // Steps 2 + 3 occur in the SAME tx. With the fix, the Trade entity is keyed by
    // (txHash, user, sessionId), so the close and the reopen produce TWO distinct
    // Trade rows: one tied to the closed session (carrying the realizedPnl), and
    // one tied to the brand-new session (with realizedPnl == 0).

    const victim = userAddress(2);
    const seller1 = userAddress(1); // counterparty of victim's original long
    const taker2 = userAddress(3); // counterparty of victim's new short

    // 1) Set up victim's long via PositionCreated in tx #1 (separate tx).
    handlePositionCreated(positionCreated(bytes32Id(1), seller1, victim, ENTRY_PRICE));

    // 2) Same tx for the close + reopen: nudge to seed=2 so both events share txHash + block.
    const exitPnl = BigInt.fromI64(5_000_000 * DURATION_DAYS);
    const exitEvent = positionExited(bytes32Id(1), victim, exitPnl);
    nudgeTx(exitEvent, 2);
    handlePositionExited(exitEvent);

    // 3) Same tx (same nudgeTx seed → same txHash + block), bump logIndex so the new
    //    session id is distinct from the old one. The reopen has victim as the SELLER.
    const reopenPrice = BigInt.fromI64(7_000_000);
    const reopen = positionCreated(bytes32Id(2), victim, taker2, reopenPrice);
    nudgeTx(reopen, 2);
    reopen.logIndex = BigInt.fromI32(5); // distinct from the exit's logIndex
    handlePositionCreated(reopen);

    // Closed session: block=1, logIndex=1, side=1 (victim was the buyer of the original long).
    const closedSession = "00000000000100000101";
    // New session: block=2, logIndex=5, side=0 (victim is the seller of the new short).
    const newSession = "00000000000200000500";

    assert.fieldEquals("PositionSession", closedSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", closedSession, "realizedPnl", exitPnl.toString());

    assert.fieldEquals("PositionSession", newSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", newSession, "entryPrice", reopenPrice.toString());
    assert.fieldEquals("PositionSession", newSession, "netQuantity", "-1");
    assert.fieldEquals("PositionSession", newSession, "closedQuantity", "0");
    assert.fieldEquals("PositionSession", newSession, "realizedPnl", "0");

    // Two Trade rows for victim in the same tx — one per session.
    const closeTradeId = nudgedTxHash(2)
      .concat(changetype<Bytes>(victim))
      .concat(Bytes.fromUTF8(closedSession))
      .toHexString();
    const newTradeId = nudgedTxHash(2)
      .concat(changetype<Bytes>(victim))
      .concat(Bytes.fromUTF8(newSession))
      .toHexString();

    // Closed-session trade: pnl from the exit, points at the closed session.
    assert.fieldEquals("Trade", closeTradeId, "positionSession", closedSession);
    assert.fieldEquals("Trade", closeTradeId, "realizedPnl", exitPnl.toString());
    assert.fieldEquals("Trade", closeTradeId, "tradeQuantity", "-1");
    assert.fieldEquals("Trade", closeTradeId, "netQuantityAfter", "0");

    // New-session trade: realizedPnl=0, points at the brand-new session — no leak.
    assert.fieldEquals("Trade", newTradeId, "positionSession", newSession);
    assert.fieldEquals("Trade", newTradeId, "realizedPnl", "0");
    assert.fieldEquals("Trade", newTradeId, "tradeQuantity", "-1");
    assert.fieldEquals("Trade", newTradeId, "netQuantityAfter", "-1");

    // Each Trade has its own Fill, also scoped to the right session.
    const closeFillId = fillAggKey(nudgedTxHash(2), victim, seller1, closedSession);
    const newFillId = fillAggKey(nudgedTxHash(2), victim, taker2, newSession);
    assert.fieldEquals("Fill", closeFillId, "positionSession", closedSession);
    assert.fieldEquals("Fill", closeFillId, "realizedPnl", exitPnl.toString());
    assert.fieldEquals("Fill", newFillId, "positionSession", newSession);
    assert.fieldEquals("Fill", newFillId, "realizedPnl", "0");
  });

  test("close-then-reopen with non-zero exit pnl: new first trade has realizedPnl=0", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    // 1) Open at ENTRY_PRICE.
    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, ENTRY_PRICE));

    // 2) Exit with a sizeable non-zero pnl — this fully closes the buyer's session.
    const exitPnl = BigInt.fromI64(5_000_000 * DURATION_DAYS);
    const exitEvent = positionExited(bytes32Id(1), buyer, exitPnl);
    nudgeTx(exitEvent, 2);
    handlePositionExited(exitEvent);

    // Sanity: pointer is flat after the close, buyer carries the realized pnl.
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "netQuantity", "0");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "currentSessionId", "");
    assert.fieldEquals("User", buyer.toHexString(), "realizedPnl", exitPnl.toString());

    // 3) New first trade after the position closed: open at a different price.
    const reopenPrice = BigInt.fromI64(7_000_000);
    const reopen = positionCreated(bytes32Id(2), seller, buyer, reopenPrice);
    nudgeTx(reopen, 3);
    handlePositionCreated(reopen);

    // The new (buyer-side) PositionSession id is bound to block=3 / logIndex=3 / side=1.
    const newSession = "00000000000300000301";
    assert.fieldEquals("PositionSession", newSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", newSession, "entryPrice", reopenPrice.toString());
    assert.fieldEquals("PositionSession", newSession, "netQuantity", "1");
    assert.fieldEquals("PositionSession", newSession, "closedQuantity", "0");
    // The first trade of a freshly opened position cannot have realized any pnl yet.
    assert.fieldEquals("PositionSession", newSession, "realizedPnl", "0");

    // The Trade aggregate for the reopen tx must have realizedPnl=0 (fresh open, no close in this tx).
    const reopenTradeId = nudgedTxHash(3)
      .concat(changetype<Bytes>(buyer))
      .concat(Bytes.fromUTF8(newSession))
      .toHexString();
    assert.fieldEquals("Trade", reopenTradeId, "realizedPnl", "0");
    assert.fieldEquals("Trade", reopenTradeId, "tradeQuantity", "1");
    assert.fieldEquals("Trade", reopenTradeId, "netQuantityAfter", "1");

    // The Fill for the reopen tx must have realizedPnl=0 too.
    const reopenFillId = fillAggKey(nudgedTxHash(3), buyer, seller, newSession);
    assert.fieldEquals("Fill", reopenFillId, "realizedPnl", "0");
    assert.fieldEquals("Fill", reopenFillId, "fillQuantity", "1");
    assert.fieldEquals("Fill", reopenFillId, "fillPrice", reopenPrice.toString());

    // User-level realizedPnl must be unchanged (still equal to the prior exit pnl, not doubled).
    assert.fieldEquals("User", buyer.toHexString(), "realizedPnl", exitPnl.toString());
  });

  test("close-then-reopen at a different price: new session entryPrice tracks new trade price", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, ENTRY_PRICE));
    const exitEvent = positionExited(bytes32Id(1), buyer, BigInt.fromI64(0));
    nudgeTx(exitEvent, 2);
    handlePositionExited(exitEvent);

    // Reopen at a different price → new session must start at the new trade price,
    // not be polluted by the old (preserved) entry.
    const reopenPrice = BigInt.fromI64(7_000_000);
    const reopen = positionCreated(bytes32Id(2), seller, buyer, reopenPrice);
    nudgeTx(reopen, 3);
    handlePositionCreated(reopen);

    const oldSession = "00000000000100000101"; // first open, side=1 buyer
    const newSession = "00000000000300000301"; // second open after close
    assert.fieldEquals("PositionSession", oldSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", oldSession, "entryPrice", ENTRY_PRICE.toString());
    assert.fieldEquals("PositionSession", newSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", newSession, "entryPrice", reopenPrice.toString());
  });

  test("PositionExited for unknown positionId is a safe no-op", () => {
    handlePositionExited(positionExited(bytes32Id(99), userAddress(1), BigInt.fromI32(0)));
    assert.entityCount("Position", 0);
    assert.entityCount("Fill", 0);
  });
});
