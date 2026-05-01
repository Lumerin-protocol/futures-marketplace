import { log } from "@graphprotocol/graph-ts";
import { OrderClosed, OrderCreated } from "../../generated/Futures/Futures";
import { Order, OrderEntry, User } from "../../generated/schema";
import { OrderEntryStatus, OrderStatus } from "../enums";
import { orderAggregateId } from "../ids";
import { recomputeOrderStatus } from "../internal/orders";
import { getOrCreateFutures, getOrCreatePriceLevel, getOrCreateUser } from "../internal/store";

/// `OrderCreated` fires once per qty=1 unit that rests in the book — taker
/// matches don't emit OrderCreated. Multiple events from one
/// `createOrder(price, deliveryAt, dest, qty=N)` call collide on the same
/// (tx, user, price, deliveryAt, side) and aggregate into one `Order` entity
/// with N `OrderEntry` children, one per on-chain orderId.
export function handleOrderCreated(event: OrderCreated): void {
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
  order.quantity += 1;
  order.originalQuantity += 1;
  order.updatedAt = event.block.timestamp;
  order.save();

  const entry = new OrderEntry(event.params.orderId);
  entry.order = order.id;
  entry.destURL = event.params.destURL;
  entry.status = OrderEntryStatus.ACTIVE;
  entry.save();

  user.lastActivityAt = event.block.timestamp;
  if (isNewAggregate) {
    user.orderCount++;
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
  }
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

/// `OrderClosed` is fired in cancel-by-self, cancel-as-outdated, liquidation,
/// AND match contexts. At emit time we cannot tell the difference, so we mark
/// the entry CANCELLED optimistically. If a `PositionCreated` later in the same
/// tx references this orderId, `handlePositionCreated` upgrades it to MATCHED
/// and rebalances the parent Order's counters.
export function handleOrderClosed(event: OrderClosed): void {
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

  entry.status = OrderEntryStatus.CANCELLED;
  entry.closedAt = event.block.timestamp;
  entry.closedBy = event.transaction.from;
  entry.save();

  order.quantity -= 1;
  order.cancelledQuantity += 1;
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
