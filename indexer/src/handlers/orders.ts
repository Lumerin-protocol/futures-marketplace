import { BigInt, log } from "@graphprotocol/graph-ts";
import { OrderClosed, OrderCreated, OrderLiquidated } from "../../generated/Futures/Futures";
import { Order, OrderEntry, User } from "../../generated/schema";
import { OrderEntryStatus, OrderStatus } from "../enums";
import { orderAggregateId } from "../ids";
import { recomputeOrderStatus } from "../internal/orders";
import { flushFuturesCounters } from "../internal/match";
import {
  getOrCreateFutures,
  getOrCreateFuturesExpiration,
  getOrCreatePriceLevel,
  getOrCreateUser,
  markLiquidationTx,
} from "../internal/store";
import { stringifyParameters } from "../internal/utils";

/// `OrderCreated` fires once per qty=1 unit that rests in the book — taker
/// matches don't emit OrderCreated. Multiple events from one
/// `createOrder(price, deliveryAt, dest, qty=N)` call collide on the same
/// (tx, user, price, deliveryAt, side) and aggregate into one `Order` entity
/// with N `OrderEntry` children, one per on-chain orderId.
export function handleOrderCreated(event: OrderCreated): void {
  log.debug("order created event {}", [stringifyParameters(event)]);

  const user = getOrCreateUser(event.params.participant, event.block.timestamp);
  const aggId = orderAggregateId(
    event.transaction.hash,
    event.params.participant,
    event.params.pricePerDay,
    event.params.deliveryAt,
    event.params.isBuy,
  );

  let order = Order.load(aggId);
  const isNewAggregate = order == null;
  if (!order) {
    order = new Order(aggId);
    order.user = user.id;
    order.price = event.params.pricePerDay;
    order.deliveryAt = event.params.deliveryAt;
    order.expiration = getOrCreateFuturesExpiration(event.params.deliveryAt).id;
    order.isBuy = event.params.isBuy;
    order.quantity = 0;
    order.originalQuantity = 0;
    order.filledQuantity = 0;
    order.cancelledQuantity = 0;
    order.status = OrderStatus.ACTIVE;
    order.createdAt = event.block.timestamp;
    order.blockNumber = event.block.number;
    order.transactionHash = event.transaction.hash;
  }
  order.quantity += 1;
  order.originalQuantity += 1;
  order.updatedAt = event.block.timestamp;
  order.save();

  const entry = new OrderEntry(event.params.orderId);
  entry.order = order.id;
  entry.destURL = event.params.destURL;
  entry.status = OrderEntryStatus.ACTIVE;
  entry.save();

  // activeOrderCount / activeOrders count individual ACTIVE OrderEntry units (one per
  // on-chain orderId), so every OrderCreated bumps by 1 regardless of aggregate state.
  // orderCount stays per-aggregate.
  user.lastActivityAt = event.block.timestamp;
  if (isNewAggregate) {
    user.orderCount++;
  }
  user.activeOrderCount++;
  user.save();

  const level = getOrCreatePriceLevel(
    event.params.deliveryAt,
    event.params.pricePerDay,
    event.params.isBuy,
  );
  level.totalQuantity += 1;
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

export function handleOrderClosed(event: OrderClosed): void {
  log.debug("order closed event {}", [stringifyParameters(event)]);
  const entry = OrderEntry.load(event.params.orderId);
  if (!entry) {
    log.warning("OrderClosed for unknown orderId {}", [event.params.orderId.toHexString()]);
    return;
  }
  if (entry.status != OrderEntryStatus.ACTIVE) return;

  const order = Order.load(entry.order);
  if (!order) {
    log.warning("OrderClosed: order aggregate not found for entry {}", [
      event.params.orderId.toHexString(),
    ]);
    return;
  }

  const entryStatus = mapOrderEntryStatus(event.params.reason);
  if (entryStatus.length == 0) {
    log.error("OrderClosed: unknown reason {} for orderId {} (tx {})", [
      BigInt.fromI32(event.params.reason).toString(),
      event.params.orderId.toHexString(),
      event.transaction.hash.toHexString(),
    ]);
    return;
  }
  const matched = entryStatus == OrderEntryStatus.MATCHED;

  entry.status = entryStatus;
  entry.closedAt = event.block.timestamp;
  entry.closedByTx = event.transaction.from;
  entry.save();

  order.quantity -= 1;
  if (matched) {
    order.filledQuantity += 1;
  } else {
    order.cancelledQuantity += 1;
  }
  order.updatedAt = event.block.timestamp;
  recomputeOrderStatus(order, event.block.timestamp);
  order.save();

  const level = getOrCreatePriceLevel(order.deliveryAt, order.price, order.isBuy);
  level.totalQuantity -= 1;
  level.save();

  // activeOrderCount / activeOrders track ACTIVE OrderEntry units (not aggregates),
  // so every OrderClosed of a previously-ACTIVE entry decrements by 1.
  const user = User.load(order.user);
  if (user) {
    user.activeOrderCount--;
    user.lastActivityAt = event.block.timestamp;
    user.save();
  }
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.activeOrders--;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

/// Overlays per-liquidation attribution onto the OrderEntry. Always fires in the same tx
/// (and after) the paired `OrderClosed(LIQUIDATED)` so the entry already exists. Kept as a
/// separate event so the much hotter `OrderClosed` topic doesn't pay for liquidator/fee
/// bytes on every cancel/match/expire. Also drives `Futures.totalLiquidations`, deduped
/// per tx via the `LiquidationTx` sentinel so multi-leg liquidation txs count once.
export function handleOrderLiquidated(event: OrderLiquidated): void {
  log.debug("order liquidated event {}", [stringifyParameters(event)]);
  const entry = OrderEntry.load(event.params.orderId);
  if (!entry) {
    log.warning("OrderLiquidated for unknown orderId {}", [event.params.orderId.toHexString()]);
    return;
  }
  entry.liquidator = event.params.liquidator;
  entry.liquidationFee = event.params.fee;
  entry.save();

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
function mapOrderEntryStatus(reason: i32): string {
  if (reason == 0) return OrderEntryStatus.MATCHED;
  if (reason == 1) return OrderEntryStatus.CANCELLED;
  if (reason == 2) return OrderEntryStatus.EXPIRED;
  if (reason == 3) return OrderEntryStatus.LIQUIDATED;
  if (reason == 4) return OrderEntryStatus.RESET;
  return "";
}
