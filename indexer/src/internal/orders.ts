import { BigInt } from "@graphprotocol/graph-ts";
import { Order } from "../../generated/schema";
import { OrderStatus } from "../enums";

/// Recompute the parent Order aggregate's status from its `quantity` /
/// `filledQuantity` / `cancelledQuantity` counters. Sets `closedAt` when the
/// aggregate transitions to a terminal state.
export function recomputeOrderStatus(order: Order, timestamp: BigInt): void {
  if (order.quantity == 0) {
    if (order.cancelledQuantity == 0) {
      order.status = OrderStatus.FILLED;
    } else if (order.filledQuantity == 0) {
      order.status = OrderStatus.CANCELLED;
    } else {
      order.status = OrderStatus.FILLED;
    }
    order.closedAt = timestamp;
  } else if (order.filledQuantity > 0 || order.cancelledQuantity > 0) {
    order.status = OrderStatus.PARTIAL;
  } else {
    order.status = OrderStatus.ACTIVE;
  }
}
