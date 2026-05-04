import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  PositionClosed,
  PositionCreated,
  PositionDeliveryClosed,
  PositionExited,
  PositionPaid,
  PositionPaymentReceived,
} from "../../generated/Futures/Futures";
import { Order, OrderEntry, Position } from "../../generated/schema";
import { OrderEntryStatus } from "../enums";
import { recomputeOrderStatus } from "../internal/orders";
import { getOrCreateFutures, getOrCreateUser } from "../internal/store";
import { applyExitFill, applyOpenFill, derivePriceFromExit } from "../internal/match";

/// On-chain flow per matched unit:
///   1. `OrderCreated(takerOrderId, taker)` + `OrderClosed(takerOrderId, taker)`
///      — synthetic taker order announced via paired events.
///   2. `OrderClosed(restingOrderId, restingParticipant)` — maker close.
///   3. (optional) `PositionExited(...)` — opposing position offset.
///   4. `PositionCreated(positionId, seller, buyer, ..., orderId=makerOrderId,
///      takerOrderId=takerOrderId)`.
/// We aggregate per-(user, counterparty, tx) into a Fill, per-(user, tx) into a
/// Trade, and maintain a `(user, deliveryAt)` PositionSession.
export function handlePositionCreated(event: PositionCreated): void {
  // Both the maker and taker entries were marked CANCELLED by the prior
  // OrderClosed events; promote both to MATCHED now that we know it was a fill.
  promoteRestingOrderToMatched(event.params.orderId, event.block.timestamp);
  promoteRestingOrderToMatched(event.params.takerOrderId, event.block.timestamp);

  const seller = getOrCreateUser(event.params.seller, event.block.timestamp);
  const buyer = getOrCreateUser(event.params.buyer, event.block.timestamp);
  const tradePrice = event.params.sellPricePerDay; // sellPx == buyPx at fill time

  const position = new Position(event.params.positionId);
  position.seller = seller.id;
  position.buyer = buyer.id;
  position.destURL = event.params.destURL;
  position.sellPricePerDay = event.params.sellPricePerDay;
  position.buyPricePerDay = event.params.buyPricePerDay;
  position.deliveryAt = event.params.deliveryAt;
  position.isPaid = false;
  position.isExited = false;
  position.isDeliveryClosed = false;
  position.isClosed = false;
  position.createdAt = event.block.timestamp;
  position.blockNumber = event.block.number;
  position.transactionHash = event.transaction.hash;

  const sellerFill = applyOpenFill(
    seller,
    buyer.id,
    -1,
    tradePrice,
    event.params.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    /* sideIndex */ 0,
  );
  const buyerFill = applyOpenFill(
    buyer,
    seller.id,
    1,
    tradePrice,
    event.params.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    /* sideIndex */ 1,
  );

  position.sellerFill = sellerFill;
  position.buyerFill = buyerFill;
  position.save();

  const futures = getOrCreateFutures();
  // Volume per matched unit: tradePrice * deliveryDurationDays.
  const volume = tradePrice.times(BigInt.fromI32(futures.deliveryDurationDays));
  futures.totalVolume = futures.totalVolume.plus(volume);
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

/// PositionExited: a participant offset out of an existing position via an
/// opposing trade in the same delivery date. Closes one unit of their net qty
/// at the trigger trade's price, generating a closing Fill against the OTHER
/// party of the original position (their original counterparty).
export function handlePositionExited(event: PositionExited): void {
  const position = Position.load(event.params.positionId);
  if (!position) {
    log.warning("PositionExited for unknown positionId {}", [
      event.params.positionId.toHexString(),
    ]);
    return;
  }

  const participant = event.params.participant;
  const exitPnl = event.params.pnl;
  const wasBuyer = position.buyer.equals(participant);
  const counterpartyId = wasBuyer ? position.seller : position.buyer;

  position.isExited = true;
  if (wasBuyer) {
    position.buyerExitPnl = exitPnl;
  } else {
    position.sellerExitPnl = exitPnl;
  }

  // Closing trade: long → flat means selling (-1), short → flat means buying (+1).
  const closeQty = wasBuyer ? -1 : 1;
  const exitPrice = derivePriceFromExit(
    wasBuyer,
    exitPnl,
    wasBuyer ? position.buyPricePerDay : position.sellPricePerDay,
  );

  const user = getOrCreateUser(participant, event.block.timestamp);
  const fillRef = applyExitFill(
    user,
    counterpartyId,
    closeQty,
    exitPrice,
    exitPnl,
    position.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    /* sideIndex */ wasBuyer ? 1 : 0,
  );

  if (wasBuyer) {
    position.buyerExitFill = fillRef;
  } else {
    position.sellerExitFill = fillRef;
  }
  position.save();
}

export function handlePositionClosed(event: PositionClosed): void {
  const position = Position.load(event.params.positionId);
  if (!position) {
    log.warning("PositionClosed for unknown positionId {}", [
      event.params.positionId.toHexString(),
    ]);
    return;
  }
  position.isClosed = true;
  position.closedAt = event.block.timestamp;
  position.save();
}

export function handlePositionDeliveryClosed(event: PositionDeliveryClosed): void {
  const position = Position.load(event.params.positionId);
  if (!position) {
    log.warning("PositionDeliveryClosed for unknown positionId {}", [
      event.params.positionId.toHexString(),
    ]);
    return;
  }
  position.isDeliveryClosed = true;
  position.closedBy = event.params.closedBy;
  position.save();
}

export function handlePositionPaid(event: PositionPaid): void {
  const position = Position.load(event.params.positionId);
  if (!position) {
    log.warning("PositionPaid for unknown positionId {}", [event.params.positionId.toHexString()]);
    return;
  }
  position.isPaid = true;
  position.save();
}

export function handlePositionPaymentReceived(event: PositionPaymentReceived): void {
  const position = Position.load(event.params.positionId);
  if (!position) {
    log.warning("PositionPaymentReceived for unknown positionId {}", [
      event.params.positionId.toHexString(),
    ]);
    return;
  }
  position.isPaid = false;
  position.save();
}

/// If a `PositionCreated` references an orderId we previously marked CANCELLED
/// in `handleOrderClosed`, this was actually a match. Flip the entry to MATCHED
/// and rebalance the parent Order's filled/cancelled counters.
function promoteRestingOrderToMatched(restingOrderId: Bytes, timestamp: BigInt): void {
  const entry = OrderEntry.load(restingOrderId);
  if (!entry) return;
  if (entry.status != OrderEntryStatus.CANCELLED) return;

  entry.status = OrderEntryStatus.MATCHED;
  entry.save();

  const order = Order.load(entry.order);
  if (order) {
    order.cancelledQuantity -= 1;
    order.filledQuantity += 1;
    recomputeOrderStatus(order, timestamp);
    order.save();
  }
}
