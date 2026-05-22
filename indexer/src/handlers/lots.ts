import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  LotClosed,
  LotCreated,
  LotLiquidated,
  LotPaid,
  LotPaymentWithdrawn,
  LotTransferred,
} from "../../generated/Futures/Futures";
import { Lot, Order, OrderEntry, User } from "../../generated/schema";
import { LotCloseReason, LotStatus } from "../enums";
import {
  applyExitFill,
  applyOpenFill,
  derivePriceFromExit,
  flushFuturesCounters,
} from "../internal/match";
import { getOrCreateFutures, getOrCreateUser, markLiquidationTx } from "../internal/store";
import { stringifyParameters } from "../internal/utils";

export function handleLotCreated(event: LotCreated): void {
  log.debug("lot created event {}", [stringifyParameters(event)]);

  const seller = getOrCreateUser(event.params.seller, event.block.timestamp);
  const buyer = getOrCreateUser(event.params.buyer, event.block.timestamp);

  const lot = new Lot(event.params.lotId);
  lot.seller = seller.id;
  lot.buyer = buyer.id;
  lot.destURL = resolveLotDestURL(event.params.makerOrderId, event.params.takerOrderId);
  lot.sellPricePerDay = event.params.pricePerDay;
  lot.buyPricePerDay = event.params.pricePerDay;
  lot.deliveryAt = event.params.deliveryAt;
  lot.makerOrderId = event.params.makerOrderId;
  lot.takerOrderId = event.params.takerOrderId;
  lot.status = LotStatus.OPEN;
  lot.isClosed = false;
  lot.isPaid = false;
  lot.isWithdrawn = false;
  lot.createdAt = event.block.timestamp;
  lot.updatedAt = event.block.timestamp;
  lot.blockNumber = event.block.number;
  lot.transactionHash = event.transaction.hash;
  lot.save();

  appendLot(seller, lot);
  appendLot(buyer, lot);

  // Load Futures once so we can read the current maker/taker fee BEFORE
  // routing per-leg fees through `applyOpenFill`. The counter flush at the
  // bottom of this handler picks up the pendingNewFills/Trades produced by
  // both legs below.
  const futures = getOrCreateFutures();
  const fees = resolveMatchFees(
    event.params.makerOrderId,
    seller.id,
    futures.makerFee,
    futures.takerFee,
  );

  applyOpenFill(
    seller,
    buyer.id,
    -1,
    event.params.pricePerDay,
    fees.partyAFee,
    event.params.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    0,
  );
  applyOpenFill(
    buyer,
    seller.id,
    1,
    event.params.pricePerDay,
    fees.partyBFee,
    event.params.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    1,
  );

  flushFuturesCounters(futures);
  const volume = event.params.pricePerDay.times(BigInt.fromI32(futures.deliveryDurationDays));
  futures.totalVolume = futures.totalVolume.plus(volume);
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleLotTransferred(event: LotTransferred): void {
  log.debug("lot transferred event {}", [stringifyParameters(event)]);

  const oldLot = Lot.load(event.params.oldLotId);
  if (!oldLot) {
    log.warning("LotTransferred for unknown oldLotId {}", [event.params.oldLotId.toHexString()]);
    return;
  }

  const exitingParticipant = event.params.exitingParticipant;
  const exitingAsSeller = oldLot.seller.equals(exitingParticipant);
  const exitingAsBuyer = oldLot.buyer.equals(exitingParticipant);
  if (!exitingAsSeller && !exitingAsBuyer) {
    log.warning("LotTransferred exiting participant {} not in lot {}", [
      exitingParticipant.toHexString(),
      oldLot.id.toHexString(),
    ]);
    return;
  }

  oldLot.status = LotStatus.REPLACED;
  oldLot.isClosed = true;
  oldLot.updatedAt = event.block.timestamp;
  oldLot.closedAt = event.block.timestamp;
  oldLot.closeTransactionHash = event.transaction.hash;
  oldLot.save();

  const newSeller = exitingAsSeller
    ? event.params.newParticipant
    : Address.fromBytes(oldLot.seller);
  const newBuyer = exitingAsBuyer ? event.params.newParticipant : Address.fromBytes(oldLot.buyer);
  const newLot = new Lot(event.params.newLotId);
  newLot.seller = newSeller;
  newLot.buyer = newBuyer;
  newLot.destURL = resolveLotDestURL(event.params.makerOrderId, event.params.takerOrderId);
  newLot.sellPricePerDay = event.params.newSellPricePerDay;
  newLot.buyPricePerDay = event.params.newBuyPricePerDay;
  newLot.deliveryAt = oldLot.deliveryAt;
  newLot.makerOrderId = event.params.makerOrderId;
  newLot.takerOrderId = event.params.takerOrderId;
  newLot.status = LotStatus.OPEN;
  newLot.isClosed = false;
  newLot.isPaid = false;
  newLot.isWithdrawn = false;
  newLot.createdAt = event.block.timestamp;
  newLot.updatedAt = event.block.timestamp;
  newLot.blockNumber = event.block.number;
  newLot.transactionHash = event.transaction.hash;
  newLot.save();

  const newSellerUser = getOrCreateUser(newSeller, event.block.timestamp);
  const newBuyerUser = getOrCreateUser(newBuyer, event.block.timestamp);
  appendLot(newSellerUser, newLot);
  appendLot(newBuyerUser, newLot);

  const exitingUser = getOrCreateUser(exitingParticipant, event.block.timestamp);
  const entrantUser = getOrCreateUser(event.params.newParticipant, event.block.timestamp);
  const counterpartyId = exitingAsBuyer ? oldLot.seller : oldLot.buyer;
  const exitingSignedQty = exitingAsBuyer ? -1 : 1;
  const entrantSignedQty = -exitingSignedQty;
  // The new match price corresponds to whichever side just changed hands —
  // the other side's price is the remaining counterparty's carried-over entry.
  const matchPrice = exitingAsSeller
    ? event.params.newSellPricePerDay
    : event.params.newBuyPricePerDay;

  // Identify maker/taker for fee routing. The contract charges
  // makerFee+takerFee on every rewire match exactly like LotCreated; on this
  // event the exiting side leaves and the new side joins, so one of
  // {exitingUser, entrantUser} was the maker (resting order) and the other
  // was the taker (incoming order).
  const futures = getOrCreateFutures();
  const fees = resolveMatchFees(
    event.params.makerOrderId,
    exitingUser.id,
    futures.makerFee,
    futures.takerFee,
  );

  applyExitFill(
    exitingUser,
    counterpartyId,
    exitingSignedQty,
    matchPrice,
    event.params.exitPnl,
    fees.partyAFee,
    oldLot.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    0,
  );
  applyOpenFill(
    entrantUser,
    counterpartyId,
    entrantSignedQty,
    matchPrice,
    fees.partyBFee,
    oldLot.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    1,
  );

  flushFuturesCounters(futures);
  const volume = matchPrice.times(BigInt.fromI32(futures.deliveryDurationDays));
  futures.totalVolume = futures.totalVolume.plus(volume);
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleLotClosed(event: LotClosed): void {
  log.debug("lot closed event {}", [stringifyParameters(event)]);

  const lot = Lot.load(event.params.lotId);
  if (!lot) {
    log.warning("LotClosed for unknown lotId {}", [event.params.lotId.toHexString()]);
    return;
  }

  const closeReason = mapLotCloseReason(event.params.reason);
  if (closeReason.length == 0) {
    log.error("LotClosed: unknown reason {} for lotId {} (tx {})", [
      BigInt.fromI32(event.params.reason).toString(),
      event.params.lotId.toHexString(),
      event.transaction.hash.toHexString(),
    ]);
    return;
  }
  lot.status = LotStatus.CLOSED;
  lot.isClosed = true;
  lot.closeReason = closeReason;
  lot.sellerPnl = event.params.sellerPnl;
  lot.buyerPnl = event.params.buyerPnl;
  lot.closedBy = event.params.closedBy;
  lot.closedAt = event.block.timestamp;
  lot.updatedAt = event.block.timestamp;
  lot.closeTransactionHash = event.transaction.hash;
  lot.save();

  const seller = getOrCreateUser(event.params.seller, event.block.timestamp);
  const buyer = getOrCreateUser(event.params.buyer, event.block.timestamp);

  // `LotClosed` doesn't emit the exit match price, so back-derive it from
  // realized PnL and the carried-over entry price. Without this, the close-leg
  // Fill.fillPrice / Trade.tradePrice would mirror entry while realizedPnl
  // reflects the exit — internally inconsistent.
  const sellerExitPrice = derivePriceFromExit(
    false,
    event.params.sellerPnl,
    lot.sellPricePerDay,
  );
  const buyerExitPrice = derivePriceFromExit(true, event.params.buyerPnl, lot.buyPricePerDay);

  // Fee attribution on LotClosed:
  //   - MUTUAL_EXIT (reason=0): the contract charges makerFee+takerFee on the
  //     match the same way it does for LotCreated, but `LotClosed` does NOT
  //     emit `makerOrderId` / `takerOrderId`, so we cannot identify which side
  //     is the maker vs taker from this event alone. Split the total evenly so
  //     PositionSession.tradingFees and Trade.tradingFee still account for the
  //     full fee envelope; per-side attribution is approximate. Follow-up
  //     would extend the contract event or pair OrderClosed(MATCHED) sentinels.
  //   - LIQUIDATION / BREACH / SETTLED / RESET: the contract skips
  //     `_chargeMatchFees` on these paths → no fee accounting needed.
  const futures = getOrCreateFutures();
  let sellerFee = BigInt.zero();
  let buyerFee = BigInt.zero();
  if (event.params.reason == 0) {
    const totalFee = futures.makerFee.plus(futures.takerFee);
    sellerFee = totalFee.div(BigInt.fromI32(2));
    buyerFee = totalFee.minus(sellerFee);
  }

  applyExitFill(
    seller,
    buyer.id,
    1,
    sellerExitPrice,
    event.params.sellerPnl,
    sellerFee,
    lot.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    0,
  );
  applyExitFill(
    buyer,
    seller.id,
    -1,
    buyerExitPrice,
    event.params.buyerPnl,
    buyerFee,
    lot.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    1,
  );

  flushFuturesCounters(futures);
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleLotPaid(event: LotPaid): void {
  log.debug("lot paid event {}", [stringifyParameters(event)]);
  const lot = Lot.load(event.params.lotId);
  if (!lot) {
    log.warning("LotPaid for unknown lotId {}", [event.params.lotId.toHexString()]);
    return;
  }
  lot.isPaid = true;
  lot.paidAt = event.block.timestamp;
  lot.updatedAt = event.block.timestamp;
  lot.paymentTransactionHash = event.transaction.hash;
  lot.save();
}

export function handleLotPaymentWithdrawn(event: LotPaymentWithdrawn): void {
  log.debug("lot payment withdrawn event {}", [stringifyParameters(event)]);
  const lot = Lot.load(event.params.lotId);
  if (!lot) {
    log.warning("LotPaymentWithdrawn for unknown lotId {}", [event.params.lotId.toHexString()]);
    return;
  }
  lot.isWithdrawn = true;
  lot.withdrawnAt = event.block.timestamp;
  lot.updatedAt = event.block.timestamp;
  lot.withdrawalTransactionHash = event.transaction.hash;
  lot.save();
}

export function handleLotLiquidated(event: LotLiquidated): void {
  log.debug("lot liquidated event {}", [stringifyParameters(event)]);
  const lot = Lot.load(event.params.lotId);
  if (!lot) {
    log.warning("LotLiquidated for unknown lotId {}", [event.params.lotId.toHexString()]);
    return;
  }
  lot.liquidatedParticipant = event.params.participant;
  lot.liquidator = event.params.liquidator;
  lot.liquidationFee = event.params.fee;
  lot.updatedAt = event.block.timestamp;
  lot.save();

  if (markLiquidationTx(event.transaction.hash)) {
    const futures = getOrCreateFutures();
    flushFuturesCounters(futures);
    futures.totalLiquidations++;
    futures.lastUpdatedAt = event.block.timestamp;
    futures.save();
  }
}

/// Empty string sentinel = unknown reason. Caller logs + skips so a future
/// on-chain enum extension fails loudly instead of being silently mislabelled.
function mapLotCloseReason(reason: i32): string {
  if (reason == 0) return LotCloseReason.MUTUAL_EXIT;
  if (reason == 1) return LotCloseReason.LIQUIDATION;
  if (reason == 2) return LotCloseReason.BREACH;
  if (reason == 3) return LotCloseReason.SETTLED;
  if (reason == 4) return LotCloseReason.RESET;
  return "";
}

function resolveLotDestURL(makerOrderId: Bytes, takerOrderId: Bytes): string {
  const takerEntry = OrderEntry.load(takerOrderId);
  if (takerEntry && takerEntry.destURL.length > 0) {
    return takerEntry.destURL;
  }

  const makerEntry = OrderEntry.load(makerOrderId);
  if (makerEntry) {
    return makerEntry.destURL;
  }

  return "";
}

/// Append-only history of lots a user has participated in. Must persist
/// independently because some callers (e.g. the remaining party on a
/// LotTransferred rewire) never reach `applyOpenFill`/`applyExitFill`, so
/// relying on a downstream `user.save()` would silently drop the append.
function appendLot(user: User, lot: Lot): void {
  const lotIds = user.lots;
  lotIds.push(lot.id);
  user.lots = lotIds;
  user.save();
}

class MatchFeeSplit {
  partyAFee: BigInt;
  partyBFee: BigInt;
  constructor(a: BigInt, b: BigInt) {
    this.partyAFee = a;
    this.partyBFee = b;
  }
}

/// Splits maker/taker fees between two participants in a match. `makerOrderId`
/// is the resting order id from the LotCreated/LotTransferred event; whichever
/// party owns that order pays `makerFee` and the other pays `takerFee`. If the
/// OrderEntry can't be resolved (defensive — shouldn't happen in practice),
/// returns zero fees and logs a warning so the bookkeeping degrades gracefully
/// instead of silently mis-attributing.
function resolveMatchFees(
  makerOrderId: Bytes,
  partyAId: Bytes,
  makerFee: BigInt,
  takerFee: BigInt,
): MatchFeeSplit {
  if (makerFee.equals(BigInt.zero()) && takerFee.equals(BigInt.zero())) {
    return new MatchFeeSplit(BigInt.zero(), BigInt.zero());
  }
  const makerEntry = OrderEntry.load(makerOrderId);
  if (!makerEntry) {
    log.warning("resolveMatchFees: maker OrderEntry {} not found; skipping fee attribution", [
      makerOrderId.toHexString(),
    ]);
    return new MatchFeeSplit(BigInt.zero(), BigInt.zero());
  }
  const makerOrder = Order.load(makerEntry.order);
  if (!makerOrder) {
    log.warning("resolveMatchFees: Order {} for maker entry {} not found", [
      makerEntry.order.toHexString(),
      makerOrderId.toHexString(),
    ]);
    return new MatchFeeSplit(BigInt.zero(), BigInt.zero());
  }
  const partyAIsMaker = makerOrder.user.equals(partyAId);
  if (partyAIsMaker) return new MatchFeeSplit(makerFee, takerFee);
  return new MatchFeeSplit(takerFee, makerFee);
}
