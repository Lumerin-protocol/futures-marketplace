import { commonSlices } from "./common";
import { buildDocument, defineSlices, type Slice } from "./slice";

/**
 * Everything the futures subgraph is asked for.
 *
 * Read the slices below as the inventory: each one names the cache entry it
 * feeds and the group that decides how often it is fetched. The documents at the
 * bottom are assembled from them — nothing is written twice, so a batched tick
 * and a hook fetching for itself cannot return different rows.
 *
 *   constants  fetched once per page load
 *   account    every tick, dropped entirely when no wallet is connected
 *   market     every tick, and only while the futures tab is the one on screen
 *   history    never on a tick; paginated tables and the trades modal
 */

// ---------------------------------------------------------------------------
// Selection sets
// ---------------------------------------------------------------------------

const CONTRACT_SPECS_FIELDS = `
  priceOracle
  minimumPriceIncrement
  contractSizeHpsDay
  contractAddress
`;

const PRICE_LEVEL_FIELDS = `
  id
  isBid
  expirationAt
  price
  totalQuantity
`;

const FUTURES_ORDER_FIELDS = `
  user {
    id
  }
  blockNumber
  cancelledQuantity
  closedAt
  expirationAt
  createdAt
  filledQuantity
  id
  isBuy
  originalQuantity
  quantity
  price
  status
  transactionHash
  updatedAt
`;

/// Closed orders additionally report who force-cancelled them, and what it cost.
const HISTORY_ORDER_FIELDS = `
  ${FUTURES_ORDER_FIELDS}
  liquidator
  liquidationFee
`;

/**
 * One fill, for `sessionIsLong`.
 *
 * The indexer has no direction field, and a closed session's `netQuantity` is
 * zero, so this is what stops every closed position reading as Long. Any fill
 * would do — see `lib/positionDirection.ts` — so this asks for one row.
 */
const DIRECTION_FILL = `
  lastFill: trades(first: 1, orderBy: timestamp, orderDirection: desc) {
    netQuantityAfter
    tradeQuantity
  }
`;

/**
 * The full `trades { … }` list is deliberately absent. Session fills were 98% of
 * this payload and nothing rendered them outside `FuturesTradesModal`, which now
 * fetches them itself via `sessionTrades`. All that is left of them is the one
 * row above.
 */
const POSITION_SESSION_FIELDS = `
  ${DIRECTION_FILL}
  closePrice
  closedQuantity
  liquidatedQuantity
  expirationAt
  entryPrice
  id
  lastTradeAt
  maxQuantity
  netQuantity
  openedAt
  realizedPnl
  status
  tradingFees
  expiration {
    settlementPrice
    settledAt
  }
  user {
    id
  }
`;

const USER_TRADE_FIELDS = `
  user {
    id
  }
  transactionHash
  blockNumber
  expirationAt
  fillCount
  id
  netQuantityAfter
  realizedPnl
  timestamp
  tradePrice
  tradeQuantity
  tradingFee
  isLiquidation
  liquidator
  liquidationFee
`;

const SESSION_TRADE_FIELDS = `
  blockNumber
  expirationAt
  fillCount
  id
  netQuantityAfter
  realizedPnl
  timestamp
  tradePrice
  tradeQuantity
  tradingFee
  transactionHash
`;

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

export const futuresSlices = defineSlices({
  // --- constants ---------------------------------------------------------

  /** Tick size, contract size and the oracle address. Governance-mutable. */
  specs: {
    alias: "specs",
    group: "constants",
    cacheKey: `["ContractSpecs"]`,
    vars: {},
    field: `
    specs: futures(id: "0") {
      ${CONTRACT_SPECS_FIELDS}
    }`,
  },

  // --- market ------------------------------------------------------------

  /**
   * The aggregated book for one expiration.
   *
   * `$bookLastId` is the pagination cursor. A batched tick passes `""` and takes
   * the first page; the hook's own paging walks it. Before slices, the batched
   * copy of this field had no cursor at all and the two had quietly diverged.
   */
  book: {
    alias: "book",
    group: "market",
    cacheKey: `["AggregateOrderBook", expirationAt]`,
    vars: { expirationAt: "BigInt!", bookFirst: "Int!", bookLastId: "ID!" },
    field: `
    book: priceLevels(
      first: $bookFirst
      where: { expirationAt: $expirationAt, id_gt: $bookLastId, totalQuantity_gte: 1 }
      orderBy: id
      orderDirection: asc
    ) {
      ${PRICE_LEVEL_FIELDS}
    }`,
  },

  recentTrades: commonSlices.recentTrades,

  // --- account -----------------------------------------------------------

  /** The account's working orders, across every expiration, not just the one on screen. */
  myOrders: {
    alias: "myOrders",
    group: "account",
    cacheKey: `["Participant", address]`,
    vars: {
      address: "ID!",
      statuses: "[String!]!",
      now: "BigInt!",
      orderFirst: "Int!",
      orderSkip: "Int!",
    },
    field: `
    myOrders: orders(
      where: { user: $address, status_in: $statuses, expirationAt_gt: $now }
      first: $orderFirst
      skip: $orderSkip
      orderBy: createdAt
      orderDirection: desc
    ) {
      ${FUTURES_ORDER_FIELDS}
    }`,
  },

  /**
   * The account's open positions.
   *
   * Filtered on `netQuantity_not: 0` where `exposure` below filters on
   * `status: OPEN`. Those are not the same set, which is why both are asked for
   * rather than one being derived from the other: collapsing them would silently
   * change what the portfolio header reports.
   */
  positions: {
    alias: "positions",
    group: "account",
    cacheKey: `["PositionBook", address]`,
    vars: { address: "ID!" },
    field: `
    positions: positionSessions(where: { user: $address, netQuantity_not: 0 }) {
      ${POSITION_SESSION_FIELDS}
    }`,
  },

  /** Open exposure per expiration, for the portfolio header's unrealized PnL. */
  exposure: {
    alias: "exposure",
    group: "account",
    cacheKey: `["PortfolioOpenExposure", "futures", address]`,
    vars: { address: "ID!", exposureFirst: "Int!" },
    field: `
    exposure: positionSessions(
      where: { user: $address, status: OPEN }
      first: $exposureFirst
    ) {
      id
      netQuantity
      entryPrice
      expirationAt
      expiration {
        settlementPrice
      }
    }`,
  },

  /**
   * Liquidation fills only, capped. Deliberately separate from the paginated
   * trade history: polling that would refetch every page the user has scrolled.
   */
  liquidations: {
    alias: "liquidations",
    group: "account",
    cacheKey: `["UserLiquidations", "futures", address]`,
    vars: { address: "ID!", liquidationsFirst: "Int!" },
    field: `
    liquidations: trades(
      where: { user: $address, isLiquidation: true }
      orderBy: timestamp
      orderDirection: desc
      first: $liquidationsFirst
    ) {
      id
      timestamp
      liquidator
    }`,
  },

  me: commonSlices.me,
  realizedBaseline: commonSlices.realizedBaseline,

  // --- history -----------------------------------------------------------

  historyOrders: {
    alias: "historyOrders",
    group: "history",
    cacheKey: `["HistoricalOrders", address]`,
    vars: { address: "ID!", historyFirst: "Int!", historySkip: "Int!" },
    field: `
    historyOrders: orders(
      where: {
        user: $address
        status_in: ["FILLED", "CANCELLED", "LIQUIDATED", "EXPIRED"]
      }
      first: $historyFirst
      skip: $historySkip
      orderBy: createdAt
      orderDirection: desc
    ) {
      ${HISTORY_ORDER_FIELDS}
    }`,
  },

  historyPositions: {
    alias: "historyPositions",
    group: "history",
    cacheKey: `["FuturesPositionHistory", address]`,
    vars: { address: "ID!", historyFirst: "Int!", historySkip: "Int!" },
    field: `
    historyPositions: positionSessions(
      where: { user: $address, status: CLOSE }
      first: $historyFirst
      skip: $historySkip
      orderBy: lastTradeAt
      orderDirection: desc
    ) {
      ${POSITION_SESSION_FIELDS}
    }`,
  },

  historyTrades: {
    alias: "historyTrades",
    group: "history",
    cacheKey: `["UserFuturesTrades", address]`,
    vars: { address: "ID!", historyFirst: "Int!", historySkip: "Int!" },
    field: `
    historyTrades: trades(
      where: { user: $address }
      orderBy: timestamp
      orderDirection: desc
      first: $historyFirst
      skip: $historySkip
    ) {
      ${USER_TRADE_FIELDS}
    }`,
  },

  /**
   * Fills for named sessions, for the trades modal. The only path by which fills
   * reach the UI; no session slice selects them.
   */
  sessionTrades: {
    alias: "sessionTrades",
    group: "history",
    cacheKey: `["SessionTrades", ids]`,
    vars: { sessionIds: "[ID!]!" },
    field: `
    sessionTrades: positionSessions(where: { id_in: $sessionIds }) {
      id
      trades {
        ${SESSION_TRADE_FIELDS}
      }
    }`,
  },
}) satisfies Record<string, Slice>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
//
// Every one of these is one or more slices above. The tick's document is not
// here: `futuresSnapshot.ts` assembles it per tick from the groups that are due.

export const ContractSpecsQuery = buildDocument("ContractSpecs", [futuresSlices.specs]);

export const AggregateOrderBookQuery = buildDocument("AggregateOrderBook", [futuresSlices.book]);

export const RecentTradesQuery = buildDocument("RecentTrades", [futuresSlices.recentTrades]);

export const UserFuturesOrdersByStatusQuery = buildDocument("UserFuturesOrdersByStatus", [
  futuresSlices.myOrders,
]);

export const PositionsBookQuery = buildDocument("PositionsBook", [futuresSlices.positions]);

export const FuturesOpenExposureQuery = buildDocument("FuturesOpenExposure", [
  futuresSlices.exposure,
]);

export const UserFuturesLiquidationsQuery = buildDocument("UserFuturesLiquidations", [
  futuresSlices.liquidations,
]);

export const VenueRealizedPnlQuery = buildDocument("VenueRealizedPnl", [
  futuresSlices.me,
  futuresSlices.realizedBaseline,
]);

export const HistoricalOrdersQuery = buildDocument("HistoricalOrders", [
  futuresSlices.historyOrders,
]);

export const HistoricalPositionsQuery = buildDocument("HistoricalPositions", [
  futuresSlices.historyPositions,
]);

export const UserFuturesTradesQuery = buildDocument("UserFuturesTrades", [
  futuresSlices.historyTrades,
]);

/**
 * The newest page of all three history tables in one request.
 *
 * `OrdersPositionsTabWidget` fetches all three up front so the tab badges are
 * right on first render, which meant three requests and three CORS preflights in
 * the same millisecond. Page 2 onwards still pages individually — by then only
 * one table is being scrolled.
 */
export const FuturesHistoryFirstPageQuery = buildDocument("FuturesHistoryFirstPage", [
  futuresSlices.historyOrders,
  futuresSlices.historyPositions,
  futuresSlices.historyTrades,
]);

export const SessionTradesQuery = buildDocument("SessionTrades", [futuresSlices.sessionTrades]);
