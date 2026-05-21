// Subgraph manifest entry point. Re-exports every event handler so that
// `subgraph.yaml` can reference a single mapping file while the implementation
// is split into `handlers/` (per-event) and `internal/` (shared helpers).

export {
  handleInitialized,
  handleMakerFeeUpdated,
  handleTakerFeeUpdated,
  handleUpgraded,
  handleValidatorURLUpdated,
} from "./handlers/admin";

export { handleOrderClosed, handleOrderCreated } from "./handlers/orders";

export {
  handleLotClosed,
  handleLotCreated,
  handleLotLiquidated,
  handleLotPaid,
  handleLotPaymentWithdrawn,
  handleLotTransferred,
} from "./handlers/lots";

export { handleBadDebt, handleLiquidation } from "./handlers/liquidation";
