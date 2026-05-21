import { log } from "@graphprotocol/graph-ts";
import { OrderClosed, OrderCreated } from "../../generated/Futures/Futures";
import { Order, OrderEntry, User } from "../../generated/schema";
import { OrderEntryStatus, OrderStatus } from "../enums";
import { orderAggregateId } from "../ids";
import { recomputeOrderStatus } from "../internal/orders";
import { getOrCreateFutures, getOrCreatePriceLevel, getOrCreateUser } from "../internal/store";
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
  // Detect a "resurrection": the aggregate exists but was at qty=0 because a
  // previous taker synthetic OrderClosed dropped it back to 0. This happens
  // when a multi-unit taker order emits N OrderCreated+OrderClosed pairs in
  // the same tx — only the first pair has isNewAggregate=true, but each
  // subsequent pair must also re-increment the active counters.
  const priorQuantity = order.quantity;
  order.quantity += 1;
  order.originalQuantity += 1;
  order.updatedAt = event.block.timestamp;
  order.save();

  const isReactivation = !isNewAggregate && priorQuantity == 0;

  const entry = new OrderEntry(event.params.orderId);
  entry.order = order.id;
  entry.destURL = event.params.destURL;
  entry.status = OrderEntryStatus.ACTIVE;
  entry.save();

  user.lastActivityAt = event.block.timestamp;
  if (isNewAggregate) {
    user.orderCount++;
    user.activeOrderCount++;
  } else if (isReactivation) {
    user.activeOrderCount++;
  }
  user.save();

  const level = getOrCreatePriceLevel(
    event.params.deliveryAt,
    event.params.pricePerDay,
    event.params.isBuy,
  );
  level.totalQuantity += 1;
  level.save();

  const futures = getOrCreateFutures();
  if (isNewAggregate) {
    futures.totalOrders++;
    futures.activeOrders++;
  } else if (isReactivation) {
    futures.activeOrders++;
  }
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
  const matched = entryStatus == OrderEntryStatus.MATCHED;

  entry.status = entryStatus;
  entry.closedAt = event.block.timestamp;
  entry.closedBy = event.transaction.from;
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

  if (order.quantity == 0) {
    const user = User.load(order.user);
    if (user) {
      user.activeOrderCount--;
      user.lastActivityAt = event.block.timestamp;
      user.save();
    }
    const futures = getOrCreateFutures();
    futures.activeOrders--;
    futures.lastUpdatedAt = event.block.timestamp;
    futures.save();
  }
}

function mapOrderEntryStatus(reason: i32): string {
  if (reason == 0) return OrderEntryStatus.MATCHED;
  if (reason == 1) return OrderEntryStatus.CANCELLED;
  if (reason == 2) return OrderEntryStatus.EXPIRED;
  if (reason == 3) return OrderEntryStatus.LIQUIDATED;
  if (reason == 4) return OrderEntryStatus.RESET;
  return OrderEntryStatus.CANCELLED;
}
