import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  Fill,
  Futures,
  PositionSession,
  Trade,
  User,
  UserDeliverySessionPointer,
} from "../../generated/schema";
import { PositionSessionStatus } from "../enums";
import { absI32, isSameSignI32, minI32 } from "../lib";
import { fillAggregateId, positionSessionId, tradeAggregateId } from "../ids";
import { getOrCreateFuturesExpiration, getOrCreatePointer } from "./store";

// ============================================================================
// Pending Futures-singleton counter deltas
// ----------------------------------------------------------------------------
// `upsertFill` used to read + write the `Futures` singleton for every Fill leg
// it processed, which produced multiple redundant store writes per handler
// invocation (each LotCreated/LotClosed processes two legs). Similarly,
// `getOrCreateUser` used to `Futures.save()` whenever a brand-new user was
// minted. Both paths now defer the write: they accumulate deltas into these
// module-level counters and callers flush them via `flushFuturesCounters`
// alongside other handler-specific Futures writes.
// ============================================================================
let pendingNewFills: i32 = 0;
let pendingNewTrades: i32 = 0;
let pendingNewUsers: i32 = 0;

/// Bumps the deferred `totalUsers` counter. Invoked by `getOrCreateUser` when
/// it mints a fresh `User` row; the actual `Futures.save()` is batched until
/// the surrounding handler calls `flushFuturesCounters`.
export function recordNewUser(): void {
  pendingNewUsers += 1;
}

/// Applies any pending fill/trade/user counter deltas onto an in-memory
/// `Futures` singleton and resets the module-level counters. Caller is
/// responsible for saving the singleton (lets the same call site also batch in
/// `totalVolume` / `lastUpdatedAt` updates without an extra store write).
export function flushFuturesCounters(futures: Futures): void {
  if (pendingNewFills != 0) {
    futures.totalFills += pendingNewFills;
    pendingNewFills = 0;
  }
  if (pendingNewTrades != 0) {
    futures.totalTrades += pendingNewTrades;
    pendingNewTrades = 0;
  }
  if (pendingNewUsers != 0) {
    futures.totalUsers += pendingNewUsers;
    pendingNewUsers = 0;
  }
}

// ============================================================================
// Public entry points
// ============================================================================

/// LotCreated leg: user is opening or scaling into a lot at `tradePrice`.
/// `tradingFee` is the flat per-unit fee this user pays on this leg (maker or
/// taker depending on which side of the match they sat on); callers compute it
/// from `Futures.makerFee` / `Futures.takerFee`.
export function applyOpenFill(
  user: User,
  counterpartyId: Bytes,
  signedQty: i32,
  tradePrice: BigInt,
  tradingFee: BigInt,
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
    tradingFee,
    deliveryAt,
    txHash,
    blockNumber,
    timestamp,
    logIndex,
    sideIndex,
  );
}

/// LotClosed/LotTransferred leg: user is closing one unit of an existing lot.
/// `tradingFee` is the flat per-unit fee this user pays on this leg (see
/// `applyOpenFill`); pass `BigInt.zero()` on fee-exempt legs (e.g. liquidation
/// or settlement paths the contract does not charge).
export function applyExitFill(
  user: User,
  counterpartyId: Bytes,
  signedQty: i32,
  exitPrice: BigInt,
  exitPnl: BigInt,
  tradingFee: BigInt,
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
    tradingFee,
    deliveryAt,
    txHash,
    blockNumber,
    timestamp,
    logIndex,
    sideIndex,
  );
}

/// pnl_event = side_sign * (trigger_price - entry_price)
/// where side_sign = +1 for buyer-exit, -1 for seller-exit. One unit settles `pricePerDay` of
/// notional (no duration multiplier), so the price delta equals the realized PnL directly.
export function derivePriceFromExit(wasBuyer: boolean, pnl: BigInt, entryPrice: BigInt): BigInt {
  return wasBuyer ? entryPrice.plus(pnl) : entryPrice.minus(pnl);
}

// ============================================================================
// Core: net-qty bookkeeping + session lifecycle + Fill/Trade aggregation
// ============================================================================

/// Applies one signed-unit fill against the user's `(user, deliveryAt)` session
/// pointer, opening / scaling / closing the session as needed and upserting the
/// per-(tx, user, counterparty, session) Fill and per-(tx, user, session) Trade
/// aggregates. Returns the Trade id so liquidation callers can flag it.
function processUserMatch(
  user: User,
  counterpartyId: Bytes,
  tradeQty: i32,
  tradePrice: BigInt,
  preComputedPnl: BigInt,
  tradingFee: BigInt,
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
  const reducingExisting = !wasFlat && !isSameSignI32(oldNet, tradeQty);

  const realizedPnl = preComputedPnl;
  const newEntry = computeNewEntryPrice(oldEntry, tradePrice, oldNet, tradeQty, newNet);

  const tradeId = handleFill(
    user,
    pointer,
    counterpartyId,
    tradeQty,
    tradePrice,
    realizedPnl,
    tradingFee,
    newNet,
    newEntry,
    oldNet,
    wasFlat,
    isNowFlat,
    reducingExisting,
    deliveryAt,
    txHash,
    blockNumber,
    timestamp,
    logIndex,
    sideIndex,
  );

  pointer.netQuantity = newNet;
  pointer.aggregatedEntryPrice = newEntry;
  pointer.save();

  user.lastActivityAt = timestamp;
  if (!realizedPnl.equals(BigInt.zero())) {
    user.realizedPnl = user.realizedPnl.plus(realizedPnl);
  }
  user.save();

  return tradeId;
}

function computeNewEntryPrice(
  oldEntry: BigInt,
  tradePrice: BigInt,
  oldNet: i32,
  tradeQty: i32,
  newNet: i32,
): BigInt {
  if (newNet == 0) return BigInt.zero();
  if (oldNet == 0) return tradePrice;
  if (isSameSignI32(oldNet, tradeQty)) {
    const oldAbs = absI32(oldNet);
    const addAbs = absI32(tradeQty);
    const newAbs = absI32(newNet);
    return oldEntry
      .times(BigInt.fromI32(oldAbs))
      .plus(tradePrice.times(BigInt.fromI32(addAbs)))
      .div(BigInt.fromI32(newAbs));
  }
  return oldEntry;
}

// ============================================================================
// Session lifecycle
// ============================================================================

function handleFill(
  user: User,
  pointer: UserDeliverySessionPointer,
  counterpartyId: Bytes,
  tradeQty: i32,
  tradePrice: BigInt,
  realizedPnl: BigInt,
  tradingFee: BigInt,
  newNet: i32,
  newEntry: BigInt,
  oldNet: i32,
  wasFlat: boolean,
  isNowFlat: boolean,
  reducingExisting: boolean,
  deliveryAt: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  timestamp: BigInt,
  logIndex: BigInt,
  sideIndex: i32,
): Bytes {
  let session: PositionSession;

  if (wasFlat) {
    const id = positionSessionId(blockNumber, logIndex, sideIndex);
    session = openSession(id, user.id, deliveryAt, newEntry, newNet, timestamp);
    pointer.currentSessionId = id;
  } else {
    const loaded = PositionSession.load(pointer.currentSessionId);
    if (!loaded) {
      log.warning("PositionSession not found for user {} sessionId '{}' deliveryAt {}", [
        user.id.toHexString(),
        pointer.currentSessionId,
        deliveryAt.toString(),
      ]);
      const id = positionSessionId(blockNumber, logIndex, sideIndex);
      session = openSession(id, user.id, deliveryAt, newEntry, newNet, timestamp);
      pointer.currentSessionId = id;
    } else {
      session = loaded;
    }
  }

  if (!isNowFlat) session.entryPrice = newEntry;
  session.netQuantity = newNet;
  session.lastTradeAt = timestamp;
  const absAfter = absI32(newNet);
  if (session.maxQuantity < absAfter) session.maxQuantity = absAfter;

  if (isNowFlat) {
    session.status = PositionSessionStatus.CLOSE;
    pointer.currentSessionId = "";
    // Breadcrumb for the same-tx `LotLiquidated` handler: once the position
    // goes flat the pointer no longer references the just-closed session, so
    // record its id here to let `handleLotLiquidated` re-derive the
    // (session-keyed) closing Trade id without a transient lookup entity.
    pointer.lastClosedSessionId = session.id;
  }

  if (reducingExisting) {
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

  // tradingFees accumulates the flat per-unit maker/taker fee on every leg of
  // the session (open + scale-in + close). The PositionSession singleton is
  // the canonical place to read total fees paid by a participant on a delivery
  // date — Trade.tradingFee is the per-tx slice (qty × per-leg fee).
  if (!tradingFee.equals(BigInt.zero())) {
    session.tradingFees = session.tradingFees.plus(
      tradingFee.times(BigInt.fromI32(absI32(tradeQty))),
    );
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
    tradingFee,
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
  initialNetQty: i32,
  timestamp: BigInt,
): PositionSession {
  const s = new PositionSession(id);
  s.status = PositionSessionStatus.OPEN;
  s.user = userId;
  s.deliveryAt = deliveryAt;
  s.expiration = getOrCreateFuturesExpiration(deliveryAt).id;
  s.entryPrice = entryPrice;
  s.closePrice = BigInt.zero();
  s.netQuantity = initialNetQty;
  s.closedQuantity = 0;
  s.liquidatedQuantity = 0;
  s.realizedPnl = BigInt.zero();
  s.maxQuantity = absI32(initialNetQty);
  s.tradingFees = BigInt.zero();
  s.openedAt = timestamp;
  s.lastTradeAt = timestamp;
  return s;
}

// ============================================================================
// Fill + Trade aggregation
// ============================================================================

function upsertFill(
  user: User,
  counterpartyId: Bytes,
  sessionId: string,
  deliveryAt: BigInt,
  fillPrice: BigInt,
  fillQty: i32,
  netQuantityAfter: i32,
  realizedPnlDelta: BigInt,
  tradingFee: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  timestamp: BigInt,
): Bytes {
  const userAddr = changetype<Address>(user.id);
  const cpAddr = changetype<Address>(counterpartyId);
  const fillId = fillAggregateId(txHash, userAddr, cpAddr, sessionId);

  let fill = Fill.load(fillId);
  const isNewFill = fill == null;

  const tradeId = tradeAggregateId(txHash, userAddr, sessionId);
  let trade = Trade.load(tradeId);
  const isNewTrade = trade == null;
  if (!trade) {
    trade = new Trade(tradeId);
    trade.user = user.id;
    trade.positionSession = sessionId;
    trade.deliveryAt = deliveryAt;
    trade.expiration = getOrCreateFuturesExpiration(deliveryAt).id;
    trade.tradePrice = BigInt.zero();
    trade.tradeQuantity = 0;
    trade.tradingFee = BigInt.zero();
    trade.realizedPnl = BigInt.zero();
    trade.netQuantityAfter = 0;
    trade.fillCount = 0;
    trade.isLiquidation = false;
    trade.timestamp = timestamp;
    trade.blockNumber = blockNumber;
    trade.transactionHash = txHash;
  }

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
  fill.save();

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
  // tradingFee aggregates the flat per-unit fee × |fillQty| across every leg
  // that lands on this Trade aggregate (one Trade per (tx, user, session)).
  if (!tradingFee.equals(BigInt.zero())) {
    trade.tradingFee = trade.tradingFee.plus(
      tradingFee.times(BigInt.fromI32(absI32(fillQty))),
    );
  }
  trade.save();

  // Deferred Futures-singleton write: caller calls `flushFuturesCounters` once
  // per handler invocation (see handlers/lots.ts).
  if (isNewFill) pendingNewFills += 1;
  if (isNewTrade) pendingNewTrades += 1;

  if (isNewFill) user.fillCount++;
  if (isNewTrade) user.tradeCount++;

  return trade.id;
}
