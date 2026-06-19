// Subgraph manifest entry point. Re-exports every event handler so that
// `subgraph.yaml` can reference a single mapping file while the implementation
// is split into `handlers/` (per-event) and `internal/` (shared helpers).

export {
  handleConfigUpdated,
  handleInitialized,
  handleUpgraded,
} from "./handlers/admin";

export {
  handleOrderClosed,
  handleOrderCreated,
  handleOrderLiquidated,
} from "./handlers/orders";

export {
  handleLotClosed,
  handleLotCreated,
  handleLotLiquidated,
  handleLotTransferred,
} from "./handlers/lots";

export { handleBadDebt } from "./handlers/liquidation";

export { handleSettlementPriceRecorded } from "./handlers/expirations";
