// Subgraph manifest entry point. Re-exports every event handler so that
// `subgraph.yaml` can reference a single mapping file while the implementation
// is split into `handlers/` (per-event) and `internal/` (shared helpers).

export {
  handleInitialized,
  handleUpgraded,
  handleFutureExpirationDatesCountUpdated,
  handleMakerFeeBpsUpdated,
  handleTakerFeeBpsUpdated,
  handleLiquidationFeeBpsUpdated,
  handleLiquidatorShareBpsUpdated,
  handleOracleUpdated,
  handlePortfolioMarginUpdated,
} from "./handlers/admin";

export {
  handleOrderCancelled,
  handleOrderCreated,
  handleOrderLiquidated,
  handleOrderMatched,
  handleOrderUpdated,
  handlePositionLiquidated,
  handlePositionSettled,
} from "./handlers/orders";

export { handleBadDebt } from "./handlers/liquidation";

export { handleSettlementPriceRecorded } from "./handlers/expirations";
