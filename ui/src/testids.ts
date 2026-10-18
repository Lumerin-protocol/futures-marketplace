/**
 * `data-testid` values the Playwright suite in ../e2e selects by. The e2e
 * page objects import this file, so renaming a value here renames it there.
 */
export const TESTIDS = {
  modal: "modal",
  accountButton: "account-button",
  chainButton: "chain-button",
  balance: {
    widget: "balance-widget",
    equity: "balance-equity",
    unrealizedPnl: "balance-unrealized-pnl",
    marginUsed: "balance-margin-used",
    available: "balance-available",
    realizedPnl: "balance-realized-pnl",
  },
  placeOrderWidget: "place-order-widget",
  ordersList: "orders-list",
  positionsList: "positions-list",
  positionHistoryList: "position-history-list",
  orderBookRow: "orderbook-row",
  orderBookCenter: "orderbook-center",
} as const;
