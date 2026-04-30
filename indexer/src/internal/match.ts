import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  Fill,
  PositionSession,
  Trade,
  User,
  UserDeliverySessionPointer,
} from "../../generated/schema";
import { PositionSessionStatus } from "../enums";
import { absI32, isSameSignI32, minI32 } from "../lib";
import { fillAggregateId, positionSessionId, tradeAggregateId } from "../ids";
import { getOrCreateFutures, getOrCreatePointer } from "./store";

// ============================================================================
// Public entry points
// ============================================================================

/// PositionCreated leg: user is opening (or scaling, or flipping into) a position
/// at `tradePrice`. Returns the Fill id so the canonical `Position` can backlink.
export function applyOpenFill(
  user: User,
  counterpartyId: Bytes,
  signedQty: i32,
  tradePrice: BigInt,
  deliveryAt: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  timestamp: BigInt,
  logIndex: BigInt,
  sideIndex: i32,
): Bytes {
  return processUserMatch(
    user,
    counterpartyId,
    signedQty,
    tradePrice,
    BigInt.zero(),
    deliveryAt,
    txHash,
    blockNumber,
    timestamp,
    logIndex,
    sideIndex,
  );
}

/// PositionExited leg: user is closing one unit of an existing position. The
/// realized pnl is supplied directly by the on-chain event.
export function applyExitFill(
  user: User,
  counterpartyId: Bytes,
  signedQty: i32,
  exitPrice: BigInt,
  exitPnl: BigInt,
  deliveryAt: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  timestamp: BigInt,
  logIndex: BigInt,
  sideIndex: i32,
): Bytes {
  return processUserMatch(
    user,
    counterpartyId,
    signedQty,
    exitPrice,
    exitPnl,
    deliveryAt,
    txHash,
    blockNumber,
    timestamp,
    logIndex,
    sideIndex,
  );
}

/// pnl_event = side_sign * (trigger_price - entry_price) * deliveryDurationDays
/// where side_sign = +1 for buyer-exit, -1 for seller-exit. Inverting recovers
/// the trigger price; if `deliveryDurationDays` is unset we fall back to the
/// entry price (degenerate but valid case).
export function derivePriceFromExit(wasBuyer: boolean, pnl: BigInt, entryPrice: BigInt): BigInt {
  const futures = getOrCreateFutures();
  const days = futures.deliveryDurationDays;
  if (days <= 0) return entryPrice;
  const pricePerDayDelta = pnl.div(BigInt.fromI32(days));
  return wasBuyer ? entryPrice.plus(pricePerDayDelta) : entryPrice.minus(pricePerDayDelta);
}

// ============================================================================
// Core: net-qty bookkeeping + session lifecycle + Fill/Trade aggregation
// ============================================================================

/// Applies one signed-unit fill against the user's `(user, deliveryAt)` session
/// pointer, opening / closing / flipping the session as needed and upserting the
/// per-(tx, user, counterparty) Fill and per-(tx, user) Trade aggregates.
/// Returns the Fill id.
function processUserMatch(
  user: User,
  counterpartyId: Bytes,
  tradeQty: i32,
  tradePrice: BigInt,
  preComputedPnl: BigInt,
  deliveryAt: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  timestamp: BigInt,
  logIndex: BigInt,
  sideIndex: i32,
): Bytes {
  const userAddr = changetype<Address>(user.id);
  const pointer = getOrCreatePointer(userAddr, deliveryAt);

  const oldNet = pointer.netQuantity;
  const oldEntry = pointer.aggregatedEntryPrice;
  const newNet = oldNet + tradeQty;

  const wasFlat = oldNet == 0;
  const isNowFlat = newNet == 0;
  const positionFlipped = !wasFlat && !isNowFlat && !isSameSignI32(oldNet, newNet);
  const isPositionClosed = isNowFlat || positionFlipped;
  const isPositionOpened = wasFlat || positionFlipped;

  // Realized PnL: take from `preComputedPnl` if supplied (PositionExited path),
  // otherwise compute from entry/trade price differential for the close portion.
  let realizedPnl = preComputedPnl;
  const reducingExisting = !wasFlat && !isSameSignI32(oldNet, tradeQty);
  if (realizedPnl.equals(BigInt.zero()) && reducingExisting) {
    const settledAbs = minI32(absI32(oldNet), absI32(tradeQty));
    const priceDiff = tradePrice.minus(oldEntry);
    const signedSettled = oldNet > 0 ? settledAbs : -settledAbs;
    realizedPnl = priceDiff.times(BigInt.fromI32(signedSettled));
  }

  const newEntry = computeNewEntryPrice(
    oldEntry,
    tradePrice,
    oldNet,
    tradeQty,
    newNet,
    wasFlat,
    isNowFlat,
    positionFlipped,
  );

  let fillId: Bytes;
  if (positionFlipped) {
    fillId = handleFlip(
      user,
      pointer,
      counterpartyId,
      tradeQty,
      tradePrice,
      realizedPnl,
      newNet,
      newEntry,
      oldNet,
      deliveryAt,
      txHash,
      blockNumber,
      timestamp,
      logIndex,
      sideIndex,
    );
  } else {
    fillId = handleNonFlip(
      user,
      pointer,
      counterpartyId,
      tradeQty,
      tradePrice,
      realizedPnl,
      newNet,
      newEntry,
      oldNet,
      isPositionOpened,
      isPositionClosed,
      deliveryAt,
      txHash,
      blockNumber,
      timestamp,
      logIndex,
      sideIndex,
    );
  }

  pointer.netQuantity = newNet;
  pointer.aggregatedEntryPrice = newEntry;
  pointer.save();

  user.lastActivityAt = timestamp;
  if (!realizedPnl.equals(BigInt.zero())) {
    user.realizedPnl = user.realizedPnl.plus(realizedPnl);
  }
  user.save();

  return fillId;
}

/// New aggregated entry price. Open / flip → trade price. Scale-in → weighted
/// avg over abs(oldNet) and abs(tradeQty). Reduce same-direction → unchanged.
/// Flat → 0.
function computeNewEntryPrice(
  oldEntry: BigInt,
  tradePrice: BigInt,
  oldNet: i32,
  tradeQty: i32,
  newNet: i32,
  wasFlat: boolean,
  isNowFlat: boolean,
  positionFlipped: boolean,
): BigInt {
  if (isNowFlat) return BigInt.zero();
  if (positionFlipped || wasFlat) return tradePrice;
  if (isSameSignI32(oldNet, tradeQty)) {
    const oldAbs = absI32(oldNet);
    const addAbs = absI32(tradeQty);
    const newAbs = absI32(newNet);
    return oldEntry
      .times(BigInt.fromI32(oldAbs))
      .plus(tradePrice.times(BigInt.fromI32(addAbs)))
      .div(BigInt.fromI32(newAbs));
  }
  // Reducing same-direction position: keep entry price unchanged.
  return oldEntry;
}

// ============================================================================
// Session lifecycle
// ============================================================================

/// Flip: closing leg attributed to the OLD session, opening leg starts a NEW
/// session. We emit two distinct Fills (each with a 1-byte side suffix) so the
/// `Position.{buyer,seller}Fill` derivations always point at the OPEN leg.
function handleFlip(
  user: User,
  pointer: UserDeliverySessionPointer,
  counterpartyId: Bytes,
  tradeQty: i32,
  tradePrice: BigInt,
  realizedPnl: BigInt,
  newNet: i32,
  newEntry: BigInt,
  oldNet: i32,
  deliveryAt: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  timestamp: BigInt,
  logIndex: BigInt,
  sideIndex: i32,
): Bytes {
  const absOld = absI32(oldNet);
  const absNew = absI32(newNet);

  // 1. Close old session.
  if (pointer.currentSessionId.length > 0) {
    const oldSession = PositionSession.load(pointer.currentSessionId);
    if (oldSession) {
      const oldClosed = oldSession.closedQuantity;
      oldSession.closedQuantity = oldClosed + absOld;
      oldSession.realizedPnl = oldSession.realizedPnl.plus(realizedPnl);
      if (oldSession.closedQuantity > 0) {
        oldSession.closePrice = oldSession.closePrice
          .times(BigInt.fromI32(oldClosed))
          .plus(tradePrice.times(BigInt.fromI32(absOld)))
          .div(BigInt.fromI32(oldSession.closedQuantity));
      }
      oldSession.status = PositionSessionStatus.CLOSE;
      oldSession.lastTradeAt = timestamp;
      oldSession.save();

      const closeQty = tradeQty > 0 ? absOld : -absOld;
      upsertFill(
        user,
        counterpartyId,
        oldSession.id,
        deliveryAt,
        tradePrice,
        closeQty,
        /* netQtyAfter */ 0,
        realizedPnl,
        txHash,
        blockNumber,
        timestamp,
      );
    }
  }

  // 2. Open new session for the residual (signed in `newNet`'s direction).
  const newSessionId = positionSessionId(blockNumber, logIndex, sideIndex * 2 + 1);
  const newSession = openSession(newSessionId, user.id, deliveryAt, newEntry, absNew, timestamp);
  newSession.save();
  pointer.currentSessionId = newSessionId;

  return upsertFill(
    user,
    counterpartyId,
    newSessionId,
    deliveryAt,
    tradePrice,
    newNet,
    newNet,
    BigInt.zero(),
    txHash,
    blockNumber,
    timestamp,
  );
}

/// Non-flip: open / scale / partial-close / full-close — all share one session.
function handleNonFlip(
  user: User,
  pointer: UserDeliverySessionPointer,
  counterpartyId: Bytes,
  tradeQty: i32,
  tradePrice: BigInt,
  realizedPnl: BigInt,
  newNet: i32,
  newEntry: BigInt,
  oldNet: i32,
  isPositionOpened: boolean,
  isPositionClosed: boolean,
  deliveryAt: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  timestamp: BigInt,
  logIndex: BigInt,
  sideIndex: i32,
): Bytes {
  let session: PositionSession;

  if (isPositionOpened) {
    const id = positionSessionId(blockNumber, logIndex, sideIndex);
    session = openSession(id, user.id, deliveryAt, newEntry, absI32(newNet), timestamp);
    pointer.currentSessionId = id;
  } else {
    const loaded = PositionSession.load(pointer.currentSessionId);
    if (!loaded) {
      log.warning("PositionSession not found for user {} sessionId '{}' deliveryAt {}", [
        user.id.toHexString(),
        pointer.currentSessionId,
        deliveryAt.toString(),
      ]);
      // Should never happen, but recover by minting a fresh session.
      const id = positionSessionId(blockNumber, logIndex, sideIndex);
      session = openSession(id, user.id, deliveryAt, newEntry, absI32(newNet), timestamp);
      pointer.currentSessionId = id;
    } else {
      session = loaded;
    }
  }

  session.entryPrice = newEntry;
  session.lastTradeAt = timestamp;
  const absAfter = absI32(newNet);
  if (session.maxQuantity < absAfter) session.maxQuantity = absAfter;

  if (isPositionClosed) {
    session.status = PositionSessionStatus.CLOSE;
    pointer.currentSessionId = "";
  }

  if (!realizedPnl.equals(BigInt.zero())) {
    const settledAbs = minI32(absI32(oldNet), absI32(tradeQty));
    const oldClosed = session.closedQuantity;
    session.closedQuantity = oldClosed + settledAbs;
    session.realizedPnl = session.realizedPnl.plus(realizedPnl);
    if (session.closedQuantity > 0) {
      session.closePrice = session.closePrice
        .times(BigInt.fromI32(oldClosed))
        .plus(tradePrice.times(BigInt.fromI32(settledAbs)))
        .div(BigInt.fromI32(session.closedQuantity));
    }
  }

  session.save();

  return upsertFill(
    user,
    counterpartyId,
    session.id,
    deliveryAt,
    tradePrice,
    tradeQty,
    newNet,
    realizedPnl,
    txHash,
    blockNumber,
    timestamp,
  );
}

function openSession(
  id: string,
  userId: Bytes,
  deliveryAt: BigInt,
  entryPrice: BigInt,
  initialAbsQty: i32,
  timestamp: BigInt,
): PositionSession {
  const s = new PositionSession(id);
  s.status = PositionSessionStatus.OPEN;
  s.user = userId;
  s.deliveryAt = deliveryAt;
  s.entryPrice = entryPrice;
  s.closePrice = BigInt.zero();
  s.closedQuantity = 0;
  s.realizedPnl = BigInt.zero();
  s.maxQuantity = initialAbsQty;
  s.tradingFees = BigInt.zero();
  s.openedAt = timestamp;
  s.lastTradeAt = timestamp;
  return s;
}

// ============================================================================
// Fill + Trade aggregation
// ============================================================================

/// Upsert the per-(tx, user, counterparty) Fill (qty-weighted price) and the
/// per-(tx, user) Trade aggregate. Bumps global + user fill/trade counters
/// only on first creation.
function upsertFill(
  user: User,
  counterpartyId: Bytes,
  sessionId: string,
  deliveryAt: BigInt,
  fillPrice: BigInt,
  fillQty: i32,
  netQuantityAfter: i32,
  realizedPnlDelta: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  timestamp: BigInt,
): Bytes {
  const userAddr = changetype<Address>(user.id);
  const cpAddr = changetype<Address>(counterpartyId);
  const fillId = fillAggregateId(txHash, userAddr, cpAddr);

  let fill = Fill.load(fillId);
  const isNewFill = fill == null;

  // Per-(tx, user) Trade aggregate (always pinned to the latest session for visibility).
  const tradeId = tradeAggregateId(txHash, userAddr);
  let trade = Trade.load(tradeId);
  const isNewTrade = trade == null;
  if (!trade) {
    trade = new Trade(tradeId);
    trade.user = user.id;
    trade.positionSession = sessionId;
    trade.deliveryAt = deliveryAt;
    trade.tradePrice = BigInt.zero();
    trade.tradeQuantity = 0;
    trade.tradingFee = BigInt.zero();
    trade.realizedPnl = BigInt.zero();
    trade.netQuantityAfter = 0;
    trade.fillCount = 0;
    trade.timestamp = timestamp;
    trade.blockNumber = blockNumber;
    trade.transactionHash = txHash;
  }
  trade.positionSession = sessionId;

  if (!fill) {
    fill = new Fill(fillId);
    fill.trade = trade.id;
    fill.user = user.id;
    fill.counterparty = counterpartyId;
    fill.positionSession = sessionId;
    fill.deliveryAt = deliveryAt;
    fill.fillPrice = BigInt.zero();
    fill.fillQuantity = 0;
    fill.netQuantityAfter = 0;
    fill.realizedPnl = BigInt.zero();
    fill.timestamp = timestamp;
    fill.blockNumber = blockNumber;
    fill.transactionHash = txHash;
  }

  // Qty-weighted price aggregation across the units already in this Fill.
  const oldAbs = absI32(fill.fillQuantity);
  const addAbs = absI32(fillQty);
  const newAbs = oldAbs + addAbs;
  if (newAbs > 0) {
    fill.fillPrice = fill.fillPrice
      .times(BigInt.fromI32(oldAbs))
      .plus(fillPrice.times(BigInt.fromI32(addAbs)))
      .div(BigInt.fromI32(newAbs));
  }
  fill.fillQuantity = fill.fillQuantity + fillQty;
  fill.netQuantityAfter = netQuantityAfter;
  fill.realizedPnl = fill.realizedPnl.plus(realizedPnlDelta);
  fill.positionSession = sessionId;
  fill.save();

  // Trade aggregation (qty-weighted price, signed qty sum).
  const tradeOldAbs = absI32(trade.tradeQuantity);
  const tradeAddAbs = absI32(fillQty);
  const tradeNewAbs = tradeOldAbs + tradeAddAbs;
  if (tradeNewAbs > 0) {
    trade.tradePrice = trade.tradePrice
      .times(BigInt.fromI32(tradeOldAbs))
      .plus(fillPrice.times(BigInt.fromI32(tradeAddAbs)))
      .div(BigInt.fromI32(tradeNewAbs));
  }
  trade.tradeQuantity = trade.tradeQuantity + fillQty;
  trade.realizedPnl = trade.realizedPnl.plus(realizedPnlDelta);
  trade.netQuantityAfter = netQuantityAfter;
  if (isNewFill) trade.fillCount++;
  trade.save();

  const futures = getOrCreateFutures();
  futures.totalFills += isNewFill ? 1 : 0;
  futures.totalTrades += isNewTrade ? 1 : 0;
  futures.lastUpdatedAt = timestamp;
  futures.save();

  if (isNewFill) user.fillCount++;
  if (isNewTrade) user.tradeCount++;

  return fillId;
}
