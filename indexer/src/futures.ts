// Subgraph manifest entry point. Re-exports every event handler so that
// `subgraph.yaml` can reference a single mapping file while the implementation
// is split into `handlers/` (per-event) and `internal/` (shared helpers).

export {
  handleInitialized,
  handleOrderFeeUpdated,
  handleUpgraded,
  handleValidatorURLUpdated,
} from "./handlers/admin";

export { handleOrderClosed, handleOrderCreated } from "./handlers/orders";

export {
  handlePositionClosed,
  handlePositionCreated,
  handlePositionDeliveryClosed,
  handlePositionExited,
  handlePositionPaid,
  handlePositionPaymentReceived,
} from "./handlers/positions";

export { handleBadDebt, handleLiquidation } from "./handlers/liquidation";
