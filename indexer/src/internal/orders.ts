import { BigInt } from "@graphprotocol/graph-ts";
import { Order } from "../../generated/schema";
import { OrderStatus } from "../enums";

/// Recompute the parent Order aggregate's status from its `quantity` /
/// `filledQuantity` / `cancelledQuantity` counters. Sets `closedAt` when the
/// aggregate transitions to a terminal state.
///
/// Terminal states are mutually exclusive and exhaustive once `quantity == 0`:
///   - FILLED            → every entry matched
///   - PARTIALLY_FILLED  → at least one matched AND at least one cancelled
///   - CANCELLED         → every entry cancelled
export function recomputeOrderStatus(order: Order, timestamp: BigInt): void {
  if (order.quantity == 0) {
    if (order.filledQuantity == 0) {
      order.status = OrderStatus.CANCELLED;
    } else if (order.cancelledQuantity == 0) {
      order.status = OrderStatus.FILLED;
    } else {
      order.status = OrderStatus.PARTIALLY_FILLED;
    }
    order.closedAt = timestamp;
  } else if (order.filledQuantity > 0 || order.cancelledQuantity > 0) {
    order.status = OrderStatus.PARTIAL;
  } else {
    order.status = OrderStatus.ACTIVE;
  }
}
