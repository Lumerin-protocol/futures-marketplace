/**
 * Splits a quantity change across a set of resting orders into the three
 * arguments `updateOrders(bytes32[] cancelIds, ReduceIntent[] reduces, OrderIntent[] intents)`
 * takes on both venues.
 *
 * Everything here is in raw on-chain units: whole contracts for futures,
 * 1e6-scaled for perps. The planner never needs to know which.
 */

export type RestingOrder = {
  id: `0x${string}`;
  /** Still-resting quantity, absolute value. */
  restingQty: bigint;
};

export type OrderUpdatePlan = {
  cancelIds: `0x${string}`[];
  /** `newQuantity` is signed to match the resting side, as the contract expects. */
  reduces: { orderId: `0x${string}`; newQuantity: bigint }[];
  /** Absolute quantity left over, still to be created. */
  leftoverQty: bigint;
};

/**
 * Take `removeQty` out of `orders`, in the order given.
 *
 * `_reduceOrderSize` rejects a new quantity of zero or one that is not strictly
 * smaller than the current one, so an order that is fully consumed becomes a
 * cancel and only a genuine partial becomes a reduce.
 */
function absorb(orders: RestingOrder[], removeQty: bigint, isBuy: boolean): OrderUpdatePlan {
  const plan: OrderUpdatePlan = { cancelIds: [], reduces: [], leftoverQty: 0n };
  let remaining = removeQty > 0n ? removeQty : 0n;

  for (const order of orders) {
    if (remaining === 0n) break;
    if (order.restingQty <= 0n) continue;

    if (remaining >= order.restingQty) {
      plan.cancelIds.push(order.id);
      remaining -= order.restingQty;
    } else {
      const newAbs = order.restingQty - remaining;
      plan.reduces.push({ orderId: order.id, newQuantity: isBuy ? newAbs : -newAbs });
      remaining = 0n;
    }
  }

  plan.leftoverQty = remaining;
  return plan;
}

/** Sum of still-resting quantity, absolute. */
export function totalRestingQty(orders: RestingOrder[]): bigint {
  return orders.reduce((sum, order) => sum + (order.restingQty > 0n ? order.restingQty : 0n), 0n);
}

/**
 * Shrink own resting orders down to `targetQty` in total.
 *
 * `orders` must be oldest-first. The newest are trimmed first so the oldest keep
 * their FIFO slot — a reduce holds its place in the price queue, a cancel does not.
 * `leftoverQty` is always zero: a shrink never has anything left to create.
 */
export function planShrink(
  orders: RestingOrder[],
  targetQty: bigint,
  isBuy: boolean,
): OrderUpdatePlan {
  const total = totalRestingQty(orders);
  if (targetQty >= total) return { cancelIds: [], reduces: [], leftoverQty: 0n };
  return absorb([...orders].reverse(), total - targetQty, isBuy);
}

/**
 * Net an incoming order against own resting orders on the opposite side.
 *
 * Walks oldest-first, mirroring the FIFO walk `_netSelfCross` performs when the
 * same order is placed as a create, so the resulting book matches what the user
 * would have got either way. `leftoverQty` is the part that still needs to be
 * created because it exceeds the resting size.
 *
 * `restingIsBuy` is the side of the *resting* orders, not the incoming one.
 */
export function planOffset(
  orders: RestingOrder[],
  incomingQty: bigint,
  restingIsBuy: boolean,
): OrderUpdatePlan {
  return absorb(orders, incomingQty, restingIsBuy);
}
