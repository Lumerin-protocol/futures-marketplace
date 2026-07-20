import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  OrderCancelled,
  OrderCreated,
  OrderLiquidated,
  OrderMatched,
  OrderUpdated,
  PositionLiquidated,
  PositionSettled,
} from "../../generated/Futures/Futures";
import { Order, OrderEntry, PositionSession, Trade, User } from "../../generated/schema";
import { OrderEntryStatus, OrderStatus } from "../enums";
import { orderAggregateId } from "../ids";
import { recomputeOrderStatus } from "../internal/orders";
import {
  applyExitFill,
  applyMatchFill,
  flushFuturesCounters,
} from "../internal/match";
import {
  getOrCreateFutures,
  getOrCreateFuturesExpiration,
  getOrCreatePointer,
  getOrCreatePriceLevel,
  getOrCreateUser,
  markLiquidationTx,
} from "../internal/store";
import { stringifyParameters } from "../internal/utils";
import { absI32 } from "../lib";

/// Stash for same-tx OrderUpdated(0) → OrderLiquidated reclassification.
let pendingZeroOrderIdHex: string = "";
let pendingZeroQty: i32 = 0;

/// One resting placement (qty-bearing). Aggregates same-tx same-price intents.
export function handleOrderCreated(event: OrderCreated): void {
  log.debug("order created event {}", [stringifyParameters(event)]);

  const qtyI32 = event.params.quantity.toI32();
  const absQtyI32 = absI32(qtyI32);
  const isBuy = qtyI32 > 0;

  const user = getOrCreateUser(event.params.participant, event.block.timestamp);
  const aggId = orderAggregateId(
    event.transaction.hash,
    event.params.participant,
    event.params.price,
    event.params.deliveryAt,
    isBuy,
  );

  let order = Order.load(aggId);
  const isNewAggregate = order == null;
  if (!order) {
    order = new Order(aggId);
    order.user = user.id;
    order.price = event.params.price;
    order.deliveryAt = event.params.deliveryAt;
    order.expiration = getOrCreateFuturesExpiration(event.params.deliveryAt).id;
    order.isBuy = isBuy;
    order.quantity = 0;
    order.originalQuantity = 0;
    order.filledQuantity = 0;
    order.cancelledQuantity = 0;
    order.status = OrderStatus.ACTIVE;
    order.createdAt = event.block.timestamp;
    order.blockNumber = event.block.number;
    order.transactionHash = event.transaction.hash;
  }
  order.quantity += absQtyI32;
  order.originalQuantity += absQtyI32;
  order.updatedAt = event.block.timestamp;
  order.save();

  // Remember for taker attribution on OrderMatched (same pattern as perps).
  user.lastCreatedOrderId = event.params.orderId;

  const entry = new OrderEntry(event.params.orderId);
  entry.order = order.id;
  entry.status = OrderEntryStatus.ACTIVE;
  entry.remainingQuantity = absQtyI32;
  entry.save();

  user.lastActivityAt = event.block.timestamp;
  if (isNewAggregate) {
    user.orderCount++;
  }
  user.activeOrderCount++;
  user.save();

  const level = getOrCreatePriceLevel(event.params.deliveryAt, event.params.price, isBuy);
  level.totalQuantity += absQtyI32;
  level.save();

  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  if (isNewAggregate) {
    futures.totalOrders++;
  }
  futures.activeOrders++;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleOrderUpdated(event: OrderUpdated): void {
  log.debug("order updated event {}", [stringifyParameters(event)]);
  const entry = OrderEntry.load(event.params.orderId);
  if (!entry) {
    log.warning("OrderUpdated for unknown orderId {}", [event.params.orderId.toHexString()]);
    return;
  }
  const order = Order.load(entry.order);
  if (!order) return;

  // Ignore duplicate updates after a terminal status (e.g. OrderUpdated(0) before
  // OrderLiquidated, or a second fill update that already zeroed the entry).
  if (entry.status != OrderEntryStatus.ACTIVE) return;

  const newQtyI32 = event.params.newQuantity.toI32();
  const newAbs = absI32(newQtyI32);
  const oldAbs = entry.remainingQuantity;
  const filledDelta = oldAbs - newAbs;
  if (filledDelta > 0) {
    order.quantity -= filledDelta;
    order.filledQuantity += filledDelta;
    const level = getOrCreatePriceLevel(order.deliveryAt, order.price, order.isBuy);
    level.totalQuantity -= filledDelta;
    level.save();
  }
  entry.remainingQuantity = newAbs;
  if (newAbs == 0) {
    entry.status = OrderEntryStatus.MATCHED;
    entry.closedAt = event.block.timestamp;
    entry.closedByTx = event.transaction.from;
    // Tentative fill attribution — OrderLiquidated may reclassify to cancel.
    pendingZeroOrderIdHex = event.params.orderId.toHexString();
    pendingZeroQty = filledDelta;
    const user = User.load(order.user);
    if (user) {
      user.activeOrderCount -= 1;
      user.save();
    }
    const futures = getOrCreateFutures();
    futures.activeOrders -= 1;
    futures.lastUpdatedAt = event.block.timestamp;
    futures.save();
  }
  entry.save();
  order.updatedAt = event.block.timestamp;
  recomputeOrderStatus(order, event.block.timestamp);
  order.save();
}

export function handleOrderCancelled(event: OrderCancelled): void {
  log.debug("order cancelled event {}", [stringifyParameters(event)]);
  const entry = OrderEntry.load(event.params.orderId);
  if (!entry) {
    log.warning("OrderCancelled for unknown orderId {}", [event.params.orderId.toHexString()]);
    return;
  }
  if (entry.status != OrderEntryStatus.ACTIVE) return;

  const order = Order.load(entry.order);
  if (!order) return;

  const rem = entry.remainingQuantity;
  // Sweeper path: delivery already passed → EXPIRED; otherwise user cancel.
  entry.status = order.deliveryAt.lt(event.block.timestamp)
    ? OrderEntryStatus.EXPIRED
    : OrderEntryStatus.CANCELLED;
  entry.closedAt = event.block.timestamp;
  entry.closedByTx = event.transaction.from;
  entry.remainingQuantity = 0;
  entry.save();

  order.quantity -= rem;
  order.cancelledQuantity += rem;
  order.updatedAt = event.block.timestamp;
  recomputeOrderStatus(order, event.block.timestamp);
  order.save();

  const level = getOrCreatePriceLevel(order.deliveryAt, order.price, order.isBuy);
  level.totalQuantity -= rem;
  level.save();

  const user = User.load(order.user);
  if (user) {
    user.activeOrderCount -= 1;
    user.lastActivityAt = event.block.timestamp;
    user.save();
  }
  const futures = getOrCreateFutures();
  futures.activeOrders -= 1;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

/// Perps-shaped match: book qty is updated by OrderUpdated; this handler only
/// records Fill/Trade/PositionSession for maker + taker.
export function handleOrderMatched(event: OrderMatched): void {
  log.debug("order matched event {}", [stringifyParameters(event)]);

  const tradePrice = event.params.tradePrice;
  const takerQty = event.params.takerQuantity.toI32();
  const absQty = absI32(takerQty);
  const deliveryAt = event.params.deliveryAt;

  const makerUser = getOrCreateUser(event.params.maker, event.block.timestamp);
  const takerUser = getOrCreateUser(event.params.taker, event.block.timestamp);

  applyMatchFill(
    takerUser,
    makerUser.id,
    takerQty,
    tradePrice,
    event.params.takerFee,
    deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    0,
  );
  applyMatchFill(
    makerUser,
    takerUser.id,
    -takerQty,
    tradePrice,
    event.params.makerFee,
    deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    1,
  );

  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.totalVolume = futures.totalVolume.plus(tradePrice.times(BigInt.fromI32(absQty)));
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleOrderLiquidated(event: OrderLiquidated): void {
  log.debug("order liquidated event {}", [stringifyParameters(event)]);
  const entry = OrderEntry.load(event.params.orderId);
  if (!entry) return;

  // OrderUpdated(0) typically ran first and marked MATCHED — overwrite to LIQUIDATED
  // and reclassify filled → cancelled for the just-zeroed qty.
  entry.status = OrderEntryStatus.LIQUIDATED;
  entry.liquidator = event.params.liquidator;
  entry.liquidationFee = event.params.fee;
  entry.closedAt = event.block.timestamp;
  entry.closedByTx = event.transaction.from;
  entry.save();

  const order = Order.load(entry.order);
  if (order != null) {
    if (pendingZeroQty > 0) {
      if (event.params.orderId.toHexString() == pendingZeroOrderIdHex) {
        order.filledQuantity -= pendingZeroQty;
        order.cancelledQuantity += pendingZeroQty;
        order.updatedAt = event.block.timestamp;
        recomputeOrderStatus(order, event.block.timestamp);
        order.save();
        pendingZeroQty = 0;
        pendingZeroOrderIdHex = "";
      }
    }
  }

  if (markLiquidationTx(event.transaction.hash)) {
    const futures = getOrCreateFutures();
    flushFuturesCounters(futures);
    futures.totalLiquidations++;
    futures.lastUpdatedAt = event.block.timestamp;
    futures.save();
  }
}

export function handlePositionLiquidated(event: PositionLiquidated): void {
  log.debug("position liquidated event {}", [stringifyParameters(event)]);
  const user = getOrCreateUser(event.params.user, event.block.timestamp);
  const closedQty = event.params.closedQuantity.toI32();
  // Derive mark from pnl = (mark − entry) × signedClose.
  const pointer = getOrCreatePointer(
    changetype<Address>(event.params.user),
    event.params.deliveryAt,
  );
  let exitPrice = pointer.aggregatedEntryPrice;
  if (closedQty != 0) {
    exitPrice = pointer.aggregatedEntryPrice.plus(
      event.params.pnl.div(BigInt.fromI32(closedQty)),
    );
  }
  // Event closedQuantity has the position's sign; trade qty is opposite (toward zero).
  const tradeId = applyExitFill(
    user,
    Bytes.empty(),
    -closedQty,
    exitPrice,
    event.params.pnl,
    BigInt.zero(),
    event.params.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    0,
  );

  const trade = Trade.load(tradeId);
  if (trade != null) {
    trade.isLiquidation = true;
    trade.liquidator = event.params.liquidator;
    trade.liquidationFee = event.params.liquidatorFee;
    // Back-fill exit price from pnl when mark was not passed through.
    // pnl = (mark - entry) * signedClose ⇒ not needed for indexing correctness.
    trade.save();

    const session = PositionSession.load(trade.positionSession);
    if (session != null) {
      session.liquidatedQuantity = session.liquidatedQuantity + absI32(closedQty);
      session.save();
    }
  }

  if (markLiquidationTx(event.transaction.hash)) {
    const futures = getOrCreateFutures();
    flushFuturesCounters(futures);
    futures.totalLiquidations++;
    futures.lastUpdatedAt = event.block.timestamp;
    futures.save();
  } else {
    const futures = getOrCreateFutures();
    flushFuturesCounters(futures);
    futures.lastUpdatedAt = event.block.timestamp;
    futures.save();
  }
}

export function handlePositionSettled(event: PositionSettled): void {
  log.debug("position settled event {}", [stringifyParameters(event)]);
  const user = getOrCreateUser(event.params.user, event.block.timestamp);
  const closedQty = event.params.closedQuantity.toI32();
  applyExitFill(
    user,
    Bytes.empty(),
    -closedQty,
    event.params.settlementPrice,
    event.params.pnl,
    BigInt.zero(),
    event.params.deliveryAt,
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
    0,
  );
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}
