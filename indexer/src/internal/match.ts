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
import { absBigInt, isSameSign, minBigInt } from "../lib";
import { fillId, positionSessionId, tradeId } from "../ids";
import { getOrCreateFuturesExpiration, getOrCreatePointer } from "./store";

// ============================================================================
// Pending Futures-singleton counter deltas
// ----------------------------------------------------------------------------
// `recordLeg` used to read + write the `Futures` singleton for every leg it
// processed, which produced multiple redundant store writes per handler
// invocation (each OrderMatched processes two legs). Similarly,
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
// Leg descriptors
// ============================================================================

/// Event coordinates shared by every leg produced from a single log.
export class FillContext {
  txHash: Bytes;
  blockNumber: BigInt;
  timestamp: BigInt;
  logIndex: BigInt;

  constructor(txHash: Bytes, blockNumber: BigInt, timestamp: BigInt, logIndex: BigInt) {
    this.txHash = txHash;
    this.blockNumber = blockNumber;
    this.timestamp = timestamp;
    this.logIndex = logIndex;
  }
}

/// Counterparty + order attribution for one side of an `OrderMatched`. Exits
/// (cash settlement, forced liquidation) close against the market rather than a
/// resting order, so they pass `null` and produce a Trade but no Fill.
export class MatchLeg {
  counterpartyId: Bytes;
  userOrderId: Bytes;
  counterpartyOrderId: Bytes;
  side: string;

  constructor(
    counterpartyId: Bytes,
    userOrderId: Bytes,
    counterpartyOrderId: Bytes,
    side: string,
  ) {
    this.counterpartyId = counterpartyId;
    this.userOrderId = userOrderId;
    this.counterpartyOrderId = counterpartyOrderId;
    this.side = side;
  }
}

// ============================================================================
// Public entry points
// ============================================================================

/// Apply one side of an `OrderMatched`: open, scale-in, reduce, or flip.
/// `netQtyAfter` / `entryPriceAfter` are the contract's own post-state (the
/// event carries them per side), so the indexer never has to re-derive a
/// rounded running average. Realized PnL for the reducing portion is computed
/// against the pointer's pre-state. `tradingFee` is the leg's total fee.
export function applyMatchFill(
  user: User,
  leg: MatchLeg,
  signedQty: BigInt,
  tradePrice: BigInt,
  tradingFee: BigInt,
  netQtyAfter: BigInt,
  entryPriceAfter: BigInt,
  expirationAt: BigInt,
  ctx: FillContext,
  sideIndex: i32,
): Bytes {
  const pointer = getOrCreatePointer(changetype<Address>(user.id), expirationAt);
  const oldNet = pointer.netQuantity;

  let pnl = BigInt.zero();
  if (!oldNet.isZero() && !isSameSign(oldNet, signedQty)) {
    const settledAbs = minBigInt(absBigInt(oldNet), absBigInt(signedQty));
    const signedClosed = oldNet.gt(BigInt.zero()) ? settledAbs : settledAbs.neg();
    // Contracts are whole units (quantityDecimals = 0), so there is no
    // quantity scale to divide out — unlike the perps mapping.
    pnl = tradePrice.minus(pointer.aggregatedEntryPrice).times(signedClosed);
  }

  return processUserMatch(
    user,
    leg,
    signedQty,
    tradePrice,
    pnl,
    tradingFee,
    netQtyAfter,
    entryPriceAfter,
    expirationAt,
    ctx,
    sideIndex,
  );
}

/// Reduce / close leg at `exitPrice` with pre-computed `exitPnl` (cash
/// settlement or forced liquidation). Post-state is derived here because these
/// events carry no per-side net-quantity snapshot. Returns the Trade id so
/// liquidation callers can flag it.
export function applyExitFill(
  user: User,
  signedQty: BigInt,
  exitPrice: BigInt,
  exitPnl: BigInt,
  expirationAt: BigInt,
  ctx: FillContext,
  sideIndex: i32,
): Bytes {
  const pointer = getOrCreatePointer(changetype<Address>(user.id), expirationAt);
  const newNet = pointer.netQuantity.plus(signedQty);
  // An exit only ever reduces toward zero, so the entry price is preserved
  // until the position is flat.
  const newEntry = newNet.isZero() ? BigInt.zero() : pointer.aggregatedEntryPrice;

  return processUserMatch(
    user,
    null,
    signedQty,
    exitPrice,
    exitPnl,
    BigInt.zero(),
    newNet,
    newEntry,
    expirationAt,
    ctx,
    sideIndex,
  );
}

// ============================================================================
// Core: net-qty bookkeeping + session lifecycle + Fill/Trade aggregation
// ============================================================================

/// Applies one signed fill against the user's `(user, expirationAt)` session
/// pointer, opening / scaling / flipping / closing the session as needed and
/// writing the per-leg Fill plus the per-(tx, user, session) Trade aggregate.
/// Returns the Trade id of the leg that closed size (or the only leg), so
/// liquidation callers can flag it.
function processUserMatch(
  user: User,
  leg: MatchLeg | null,
  tradeQty: BigInt,
  tradePrice: BigInt,
  realizedPnl: BigInt,
  tradingFee: BigInt,
  newNet: BigInt,
  newEntry: BigInt,
  expirationAt: BigInt,
  ctx: FillContext,
  sideIndex: i32,
): Bytes {
  const pointer = getOrCreatePointer(changetype<Address>(user.id), expirationAt);

  const oldNet = pointer.netQuantity;
  const oldEntry = pointer.aggregatedEntryPrice;
  const flipped = !oldNet.isZero() && !newNet.isZero() && !isSameSign(oldNet, newNet);

  let id: Bytes;
  if (flipped) {
    id = handleFlip(
      user,
      pointer,
      leg,
      tradeQty,
      tradePrice,
      realizedPnl,
      tradingFee,
      newNet,
      newEntry,
      oldNet,
      oldEntry,
      expirationAt,
      ctx,
      sideIndex,
    );
  } else {
    id = handleNonFlip(
      user,
      pointer,
      leg,
      tradeQty,
      tradePrice,
      realizedPnl,
      tradingFee,
      newNet,
      newEntry,
      oldNet,
      expirationAt,
      ctx,
      sideIndex,
    );
  }

  pointer.netQuantity = newNet;
  pointer.aggregatedEntryPrice = newEntry;
  pointer.save();

  user.lastActivityAt = ctx.timestamp;
  if (!realizedPnl.isZero()) {
    user.realizedPnl = user.realizedPnl.plus(realizedPnl);
  }
  user.save();

  return id;
}

// ============================================================================
// Session lifecycle
// ============================================================================

/// Sign flip: the old session is closed out at `tradePrice` and a brand-new one
/// is opened for the residual, so a reversal never smears two directions across
/// one session. Mirrors the perps mapping. Returns the closing leg's Trade id
/// (the reversal's realized PnL belongs to the session that just closed).
function handleFlip(
  user: User,
  pointer: UserDeliverySessionPointer,
  leg: MatchLeg | null,
  tradeQty: BigInt,
  tradePrice: BigInt,
  realizedPnl: BigInt,
  tradingFee: BigInt,
  newNet: BigInt,
  newEntry: BigInt,
  oldNet: BigInt,
  oldEntry: BigInt,
  expirationAt: BigInt,
  ctx: FillContext,
  sideIndex: i32,
): Bytes {
  const zero = BigInt.zero();
  const absOld = absBigInt(oldNet);
  let closeTradeId: Bytes | null = null;

  const oldSession = PositionSession.load(pointer.currentSessionId);
  if (oldSession) {
    accrueClose(oldSession, absOld, tradePrice, realizedPnl);
    oldSession.netQuantity = zero;
    oldSession.status = PositionSessionStatus.CLOSE;
    oldSession.lastTradeAt = ctx.timestamp;
    if (!tradingFee.isZero()) {
      oldSession.tradingFees = oldSession.tradingFees.plus(tradingFee);
    }
    oldSession.save();
    pointer.lastClosedSessionId = oldSession.id;

    const closeQty = tradeQty.gt(zero) ? absOld : absOld.neg();
    closeTradeId = recordLeg(
      user,
      leg,
      oldSession,
      expirationAt,
      tradePrice,
      closeQty,
      zero,
      oldEntry,
      realizedPnl,
      tradingFee,
      ctx,
      sideIndex,
    );
  } else {
    log.warning("PositionSession not found on flip for user {} sessionId '{}' expirationAt {}", [
      user.id.toHexString(),
      pointer.currentSessionId,
      expirationAt.toString(),
    ]);
  }

  // The residual opens a fresh session, and its Fill gets leg index
  // `sideIndex + 2`; both keep the ids disjoint from what the other side of the
  // same log writes at `sideIndex`.
  const newSession = openSession(
    positionSessionId(ctx.blockNumber, ctx.logIndex, sideIndex + 2),
    user.id,
    expirationAt,
    newEntry,
    newNet,
    ctx.timestamp,
  );
  newSession.save();
  pointer.currentSessionId = newSession.id;

  // The fee and PnL were fully attributed to the closing leg above.
  const openTradeId = recordLeg(
    user,
    leg,
    newSession,
    expirationAt,
    tradePrice,
    newNet,
    newNet,
    newEntry,
    zero,
    zero,
    ctx,
    sideIndex + 2,
  );

  if (closeTradeId) return closeTradeId as Bytes;
  return openTradeId;
}

/// Everything that is not a sign flip: open, scale-in, partial close, or full
/// close, all within a single session.
function handleNonFlip(
  user: User,
  pointer: UserDeliverySessionPointer,
  leg: MatchLeg | null,
  tradeQty: BigInt,
  tradePrice: BigInt,
  realizedPnl: BigInt,
  tradingFee: BigInt,
  newNet: BigInt,
  newEntry: BigInt,
  oldNet: BigInt,
  expirationAt: BigInt,
  ctx: FillContext,
  sideIndex: i32,
): Bytes {
  const isNowFlat = newNet.isZero();
  let session: PositionSession;

  if (oldNet.isZero()) {
    session = openSession(
      positionSessionId(ctx.blockNumber, ctx.logIndex, sideIndex),
      user.id,
      expirationAt,
      newEntry,
      newNet,
      ctx.timestamp,
    );
    pointer.currentSessionId = session.id;
  } else {
    const loaded = PositionSession.load(pointer.currentSessionId);
    if (!loaded) {
      log.warning("PositionSession not found for user {} sessionId '{}' expirationAt {}", [
        user.id.toHexString(),
        pointer.currentSessionId,
        expirationAt.toString(),
      ]);
      session = openSession(
        positionSessionId(ctx.blockNumber, ctx.logIndex, sideIndex),
        user.id,
        expirationAt,
        newEntry,
        newNet,
        ctx.timestamp,
      );
      pointer.currentSessionId = session.id;
    } else {
      session = loaded;
    }
  }

  // On a full close the post-state entry price is zero; keep the historical
  // entry price so the closed session still shows what it was opened at.
  if (!isNowFlat) session.entryPrice = newEntry;
  session.netQuantity = newNet;
  session.lastTradeAt = ctx.timestamp;
  const absAfter = absBigInt(newNet);
  if (session.maxQuantity.lt(absAfter)) session.maxQuantity = absAfter;

  if (isNowFlat) {
    session.status = PositionSessionStatus.CLOSE;
    pointer.currentSessionId = "";
    // Breadcrumb for same-tx PositionLiquidated: once flat, the pointer no
    // longer references the just-closed session.
    pointer.lastClosedSessionId = session.id;
  }

  // Any leg that opposes the running position settles size, whether or not it
  // happened to break even.
  if (!oldNet.isZero() && !isSameSign(oldNet, tradeQty)) {
    accrueClose(
      session,
      minBigInt(absBigInt(oldNet), absBigInt(tradeQty)),
      tradePrice,
      realizedPnl,
    );
  }

  // tradingFees accumulates the maker/taker fee on every leg of the session
  // (open + scale-in + close). The PositionSession is the canonical place to
  // read total fees paid by a participant on a delivery date —
  // Trade.tradingFee is the per-tx slice.
  if (!tradingFee.isZero()) {
    session.tradingFees = session.tradingFees.plus(tradingFee);
  }

  session.save();

  return recordLeg(
    user,
    leg,
    session,
    expirationAt,
    tradePrice,
    tradeQty,
    newNet,
    newEntry,
    realizedPnl,
    tradingFee,
    ctx,
    sideIndex,
  );
}

/// Fold `settledAbs` contracts closed at `exitPrice` into a session's
/// close statistics (running qty-weighted close price + realized PnL).
function accrueClose(
  session: PositionSession,
  settledAbs: BigInt,
  exitPrice: BigInt,
  realizedPnl: BigInt,
): void {
  const oldClosed = session.closedQuantity;
  session.closedQuantity = oldClosed.plus(settledAbs);
  session.realizedPnl = session.realizedPnl.plus(realizedPnl);
  if (session.closedQuantity.gt(BigInt.zero())) {
    session.closePrice = session.closePrice
      .times(oldClosed)
      .plus(exitPrice.times(settledAbs))
      .div(session.closedQuantity);
  }
}

function openSession(
  id: string,
  userId: Bytes,
  expirationAt: BigInt,
  entryPrice: BigInt,
  initialNetQty: BigInt,
  timestamp: BigInt,
): PositionSession {
  const s = new PositionSession(id);
  s.status = PositionSessionStatus.OPEN;
  s.user = userId;
  s.expirationAt = expirationAt;
  s.expiration = getOrCreateFuturesExpiration(expirationAt).id;
  s.entryPrice = entryPrice;
  s.closePrice = BigInt.zero();
  s.netQuantity = initialNetQty;
  s.closedQuantity = BigInt.zero();
  s.liquidatedQuantity = BigInt.zero();
  s.realizedPnl = BigInt.zero();
  s.maxQuantity = absBigInt(initialNetQty);
  s.tradingFees = BigInt.zero();
  s.openedAt = timestamp;
  s.lastTradeAt = timestamp;
  return s;
}

// ============================================================================
// Fill + Trade aggregation
// ============================================================================

/// Write the immutable per-leg Fill (skipped when `leg` is null, i.e. an exit
/// with no matched counterparty order) and fold the leg into the
/// per-(tx, user, session) Trade aggregate. Returns the Trade id.
function recordLeg(
  user: User,
  leg: MatchLeg | null,
  session: PositionSession,
  expirationAt: BigInt,
  fillPrice: BigInt,
  fillQty: BigInt,
  netQuantityAfter: BigInt,
  entryPriceAfter: BigInt,
  realizedPnl: BigInt,
  tradingFee: BigInt,
  ctx: FillContext,
  legIndex: i32,
): Bytes {
  const id = tradeId(ctx.txHash, changetype<Address>(user.id), session.id);
  let trade = Trade.load(id);
  const isNewTrade = trade == null;
  if (!trade) {
    trade = new Trade(id);
    trade.user = user.id;
    trade.positionSession = session.id;
    trade.expirationAt = expirationAt;
    trade.expiration = getOrCreateFuturesExpiration(expirationAt).id;
    trade.tradePrice = BigInt.zero();
    trade.tradeQuantity = BigInt.zero();
    trade.tradingFee = BigInt.zero();
    trade.realizedPnl = BigInt.zero();
    trade.netQuantityAfter = BigInt.zero();
    trade.aggregatedEntryPriceAfter = BigInt.zero();
    trade.fillCount = 0;
    trade.isLiquidation = false;
    trade.timestamp = ctx.timestamp;
    trade.blockNumber = ctx.blockNumber;
    trade.transactionHash = ctx.txHash;
  }

  if (leg) {
    const matched = leg as MatchLeg;
    const fill = new Fill(fillId(ctx.txHash, ctx.logIndex, legIndex));
    fill.trade = id;
    fill.side = matched.side;
    fill.user = user.id;
    fill.counterparty = matched.counterpartyId;
    fill.order = matched.userOrderId;
    fill.counterpartyOrder = matched.counterpartyOrderId;
    fill.positionSession = session.id;
    fill.expirationAt = expirationAt;
    fill.fillPrice = fillPrice;
    fill.fillQuantity = fillQty;
    fill.netQuantityAfter = netQuantityAfter;
    fill.aggregatedEntryPriceAfter = entryPriceAfter;
    fill.realizedPnl = realizedPnl;
    fill.tradingFee = tradingFee;
    fill.timestamp = ctx.timestamp;
    fill.blockNumber = ctx.blockNumber;
    fill.transactionHash = ctx.txHash;
    fill.save();

    trade.fillCount++;
    pendingNewFills += 1;
    user.fillCount++;
  }

  const oldAbs = absBigInt(trade.tradeQuantity);
  const addAbs = absBigInt(fillQty);
  const newAbs = oldAbs.plus(addAbs);
  if (newAbs.gt(BigInt.zero())) {
    trade.tradePrice = trade.tradePrice
      .times(oldAbs)
      .plus(fillPrice.times(addAbs))
      .div(newAbs);
  }
  trade.tradeQuantity = trade.tradeQuantity.plus(fillQty);
  trade.tradingFee = trade.tradingFee.plus(tradingFee);
  trade.realizedPnl = trade.realizedPnl.plus(realizedPnl);
  trade.netQuantityAfter = netQuantityAfter;
  trade.aggregatedEntryPriceAfter = entryPriceAfter;
  trade.save();

  if (isNewTrade) {
    pendingNewTrades += 1;
    user.tradeCount++;
  }

  return id;
}
