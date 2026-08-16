import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  OrderCancelled,
  OrderCreated,
  OrderLiquidated,
  OrderMatched,
  OrderUpdated,
  PositionLiquidated,
  PositionSettled,
} from "../../generated/HashPowerFutures/HashPowerFutures";
import { Order, PositionSession, Trade, User } from "../../generated/schema";
import { FillSide, OrderStatus } from "../enums";
import {
  closeOrder,
  isTerminalOrderStatus,
  refreshOpenOrderStatus,
  syncCancelledQuantity,
} from "../internal/orders";
import {
  applyExitFill,
  applyMatchFill,
  FillContext,
  flushFuturesCounters,
  MatchLeg,
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
import { absBigInt } from "../lib";

/// One Order per on-chain orderId, so `Order.id` is the handle cancelOrder /
/// liquidateOrders take. `createOrder` emits OrderCreated with the requested
/// quantity *before* matching, so the order is booked at full size here and the
/// trailing OrderUpdated shrinks it down to whatever actually rested.
export function handleOrderCreated(event: OrderCreated): void {
  log.debug("order created event {}", [stringifyParameters(event)]);

  const signedQty = event.params.quantity;
  const absQty = absBigInt(signedQty);
  const isBuy = signedQty.gt(BigInt.zero());

  const user = getOrCreateUser(event.params.participant, event.block.timestamp);

  const order = new Order(event.params.orderId);
  order.user = user.id;
  order.price = event.params.price;
  order.expirationAt = event.params.expirationAt;
  order.expiration = getOrCreateFuturesExpiration(event.params.expirationAt).id;
  order.isBuy = isBuy;
  order.quantity = absQty;
  order.originalQuantity = absQty;
  order.filledQuantity = BigInt.zero();
  order.cancelledQuantity = BigInt.zero();
  order.averageFillPrice = BigInt.zero();
  order.status = OrderStatus.ACTIVE;
  order.createdAt = event.block.timestamp;
  order.updatedAt = event.block.timestamp;
  order.blockNumber = event.block.number;
  order.transactionHash = event.transaction.hash;
  order.save();

  // Remember this orderId so handleOrderMatched can attribute the taker side:
  // OrderMatched only carries makerOrderId, and the taker's OrderCreated always
  // fires first (same pattern as perps).
  user.lastCreatedOrderId = event.params.orderId;
  user.lastActivityAt = event.block.timestamp;
  user.orderCount++;
  user.activeOrderCount++;
  user.save();

  const level = getOrCreatePriceLevel(event.params.expirationAt, event.params.price, isBuy);
  level.totalQuantity = level.totalQuantity.plus(absQty);
  level.orderCount++;
  level.save();

  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.totalOrders++;
  futures.activeOrders++;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

/// Remaining size only. `filledQuantity` is owned by OrderMatched, so a lone
/// shrink (reduce-only amend or a self-cross the taker paid for) is not a fill.
export function handleOrderUpdated(event: OrderUpdated): void {
  log.debug("order updated event {}", [stringifyParameters(event)]);

  const order = Order.load(event.params.orderId);
  if (!order) {
    log.warning("OrderUpdated for unknown orderId {}", [event.params.orderId.toHexString()]);
    return;
  }
  if (isTerminalOrderStatus(order.status)) return;

  const newAbs = absBigInt(event.params.newQuantity);
  const shrink = order.quantity.minus(newAbs);
  const isClosed = newAbs.isZero();

  // The book always follows the remaining size.
  const level = getOrCreatePriceLevel(order.expirationAt, order.price, order.isBuy);
  level.totalQuantity = level.totalQuantity.minus(shrink);
  if (isClosed) level.orderCount--;
  level.save();

  order.quantity = newAbs;
  order.updatedAt = event.block.timestamp;

  if (isClosed) {
    // Either a full fill or an IOC / self-cross close with nothing matched.
    // HashPowerFutures emits the maker's OrderUpdated *before* its
    // OrderMatched, so a fill arriving next upgrades CANCELLED to FILLED (see
    // `creditFill`).
    closeOrder(
      order,
      order.filledQuantity.isZero() ? OrderStatus.CANCELLED : OrderStatus.FILLED,
      event.block.timestamp,
      event.transaction.from,
    );
    order.save();
    releaseRestingOrder(order, event.block.timestamp);
    return;
  }

  syncCancelledQuantity(order);
  refreshOpenOrderStatus(order);
  order.save();
}

export function handleOrderCancelled(event: OrderCancelled): void {
  log.debug("order cancelled event {}", [stringifyParameters(event)]);

  const order = Order.load(event.params.orderId);
  if (!order) {
    log.warning("OrderCancelled for unknown orderId {}", [event.params.orderId.toHexString()]);
    return;
  }
  // `liquidateOrder` co-emits OrderCancelled + OrderLiquidated in one tx.
  // LIQUIDATED is terminal and must never be downgraded, and the book / user /
  // global counters must move exactly once whichever log lands first.
  if (isTerminalOrderStatus(order.status)) return;

  const level = getOrCreatePriceLevel(order.expirationAt, order.price, order.isBuy);
  level.totalQuantity = level.totalQuantity.minus(order.quantity);
  level.orderCount--;
  level.save();

  // Sweeper path: the expiration already passed → EXPIRED; otherwise a cancel.
  closeOrder(
    order,
    order.expirationAt.lt(event.block.timestamp) ? OrderStatus.EXPIRED : OrderStatus.CANCELLED,
    event.block.timestamp,
    event.transaction.from,
  );
  order.save();

  releaseRestingOrder(order, event.block.timestamp);
}

/// Book qty is updated by OrderUpdated; this handler records the
/// Fill / Trade / PositionSession state for both sides and credits the fill
/// against both order ids.
export function handleOrderMatched(event: OrderMatched): void {
  log.debug("order matched event {}", [stringifyParameters(event)]);

  const tradePrice = event.params.tradePrice;
  const takerQty = event.params.takerQuantity;
  const absQty = absBigInt(takerQty);
  const expirationAt = event.params.expirationAt;

  const makerUser = getOrCreateUser(event.params.maker, event.block.timestamp);
  const takerUser = getOrCreateUser(event.params.taker, event.block.timestamp);

  const makerOid = event.params.makerOrderId;
  const takerOid = takerUser.lastCreatedOrderId;

  const ctx = new FillContext(
    event.transaction.hash,
    event.block.number,
    event.block.timestamp,
    event.logIndex,
  );

  applyMatchFill(
    takerUser,
    new MatchLeg(makerUser.id, takerOid, makerOid, FillSide.TAKER),
    takerQty,
    tradePrice,
    event.params.takerFee,
    event.params.takerNetQtyAfter,
    event.params.takerEntryPriceAfter,
    expirationAt,
    ctx,
    0,
  );
  // Re-load the maker: on a self-match both legs mutate the same `User` row, so
  // the maker leg has to start from the counters the taker leg just wrote.
  applyMatchFill(
    getOrCreateUser(event.params.maker, event.block.timestamp),
    new MatchLeg(takerUser.id, makerOid, takerOid, FillSide.MAKER),
    takerQty.neg(),
    tradePrice,
    event.params.makerFee,
    event.params.makerNetQtyAfter,
    event.params.makerEntryPriceAfter,
    expirationAt,
    ctx,
    1,
  );

  creditFill(takerOid, tradePrice, absQty, event.block.timestamp);
  creditFill(makerOid, tradePrice, absQty, event.block.timestamp);

  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.totalVolume = futures.totalVolume.plus(tradePrice.times(absQty));
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleOrderLiquidated(event: OrderLiquidated): void {
  log.debug("order liquidated event {}", [stringifyParameters(event)]);

  const order = Order.load(event.params.orderId);
  if (!order) {
    log.warning("OrderLiquidated for unknown orderId {}", [event.params.orderId.toHexString()]);
    return;
  }

  // `_doLiquidateOrder` emits OrderCancelled first, so the book cleanup has
  // normally already happened; only redo it when this log arrives first.
  if (!isTerminalOrderStatus(order.status)) {
    const level = getOrCreatePriceLevel(order.expirationAt, order.price, order.isBuy);
    level.totalQuantity = level.totalQuantity.minus(order.quantity);
    level.orderCount--;
    level.save();
    releaseRestingOrder(order, event.block.timestamp);
  }

  closeOrder(order, OrderStatus.LIQUIDATED, event.block.timestamp, event.transaction.from);
  order.liquidator = event.params.liquidator;
  order.liquidationFee = event.params.fee;
  order.save();

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
  const closedQty = event.params.closedQuantity;
  const pointer = getOrCreatePointer(
    changetype<Address>(event.params.user),
    event.params.expirationAt,
  );
  // Derive the forced exit price from the realized PnL the event reports:
  //   pnl = (mark − entry) × signedClose ⇒ mark = entry + pnl / signedClose.
  let exitPrice = pointer.aggregatedEntryPrice;
  if (!closedQty.isZero()) {
    exitPrice = pointer.aggregatedEntryPrice.plus(event.params.pnl.div(closedQty));
  }

  // `closedQuantity` carries the position's sign; the forced trade offsets it.
  const tradeId = applyExitFill(
    user,
    closedQty.neg(),
    exitPrice,
    event.params.pnl,
    event.params.expirationAt,
    new FillContext(
      event.transaction.hash,
      event.block.number,
      event.block.timestamp,
      event.logIndex,
    ),
    0,
  );

  const trade = Trade.load(tradeId);
  if (trade != null) {
    trade.isLiquidation = true;
    trade.liquidator = event.params.liquidator;
    trade.liquidationFee = event.params.liquidatorFee;
    trade.save();

    const session = PositionSession.load(trade.positionSession);
    if (session != null) {
      session.liquidatedQuantity = session.liquidatedQuantity.plus(absBigInt(closedQty));
      session.save();
    }
  }

  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  if (markLiquidationTx(event.transaction.hash)) {
    futures.totalLiquidations++;
  }
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handlePositionSettled(event: PositionSettled): void {
  log.debug("position settled event {}", [stringifyParameters(event)]);

  const user = getOrCreateUser(event.params.user, event.block.timestamp);
  applyExitFill(
    user,
    event.params.closedQuantity.neg(),
    event.params.settlementPrice,
    event.params.pnl,
    event.params.expirationAt,
    new FillContext(
      event.transaction.hash,
      event.block.number,
      event.block.timestamp,
      event.logIndex,
    ),
    0,
  );

  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

/// Credit one match against an order: running fill VWAP, `filledQuantity`, and
/// the derived status. Called for BOTH sides of every OrderMatched — the maker
/// order id comes off the event, the taker's off `User.lastCreatedOrderId`.
function creditFill(
  orderId: Bytes,
  fillPrice: BigInt,
  absFillQty: BigInt,
  timestamp: BigInt,
): void {
  const order = Order.load(orderId);
  if (!order) {
    log.warning("Order not found for fill credit: {}", [orderId.toHexString()]);
    return;
  }

  const oldFilled = order.filledQuantity;
  const newFilled = oldFilled.plus(absFillQty);
  if (newFilled.gt(BigInt.zero())) {
    order.averageFillPrice = order.averageFillPrice
      .times(oldFilled)
      .plus(fillPrice.times(absFillQty))
      .div(newFilled);
  }
  order.filledQuantity = newFilled;
  order.updatedAt = timestamp;
  syncCancelledQuantity(order);

  // A keeper or the expiry sweeper owns the close attribution; the fill only
  // moves the counters. Otherwise: the maker's OrderUpdated(0) already ran and
  // provisionally called this a cancel, so upgrade it to FILLED.
  if (order.status == OrderStatus.LIQUIDATED || order.status == OrderStatus.EXPIRED) {
    order.save();
    return;
  }
  if (order.quantity.isZero()) {
    order.status = OrderStatus.FILLED;
    order.closedAt = timestamp;
  } else {
    order.status = OrderStatus.PARTIALLY_FILLED;
  }
  order.save();
}

/// Drop one order out of the resting-order counters. Call after the order has
/// been moved to a terminal status.
function releaseRestingOrder(order: Order, timestamp: BigInt): void {
  const user = User.load(order.user);
  if (user) {
    user.activeOrderCount--;
    user.lastActivityAt = timestamp;
    user.save();
  }

  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.activeOrders--;
  futures.lastUpdatedAt = timestamp;
  futures.save();
}
