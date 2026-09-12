import { commonSlices } from "./common";
import { buildDocument, defineSlices, type Slice } from "./slice";

/**
 * Everything the perps subgraph is asked for. Mirrors `queries/futures.ts`; see
 * that file's header for how to read a slice.
 */

// ---------------------------------------------------------------------------
// Selection sets
// ---------------------------------------------------------------------------

const PERPS_PRICE_LEVEL_FIELDS = `
  id
  isBid
  orderCount
  price
  totalQuantity
`;

const PERPS_ORDER_FIELDS = `
  blockNumber
  closedAt
  createdAt
  filledQuantity
  id
  originalQuantity
  isBuy
  price
  quantity
  status
  transactionHash
  updatedAt
  user {
    id
  }
`;

/** One fill, for `sessionIsLong`. See the futures counterpart. */
const DIRECTION_FILL = `
  lastFill: trades(first: 1, orderBy: timestamp, orderDirection: desc) {
    netQuantityAfter
    tradeQuantity
  }
`;

/**
 * No full `trades { … }` list, for the same reason as futures: these ride the
 * 5-second tick, and the perps trade-details modal is the only thing that
 * renders fills. It fetches them itself via `sessionTrades`.
 */
const PERPS_POSITION_SESSION_FIELDS = `
  ${DIRECTION_FILL}
  closePrice
  entryPrice
  closedQuantity
  liquidatedQuantity
  fundingFees
  id
  lastTradeAt
  maxQuantity
  netQuantity
  openedAt
  realizedPnl
  status
  tradingFees
  user {
    id
  }
`;

const PERPS_SESSION_TRADE_FIELDS = `
  aggregatedEntryPriceAfter
  blockNumber
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

export const perpsSlices = defineSlices({
  // --- constants ---------------------------------------------------------

  /**
   * Fees, minimum margin and tick size.
   *
   * `totalVolume` rides along and *does* move, so it freezes for the session.
   * That is accepted: it is a header stat, not a trading input. Splitting it out
   * would mean two cache writes for one entity to keep one number live.
   */
  collection: {
    alias: "collection",
    group: "constants",
    cacheKey: `["PerpsCollection"]`,
    vars: {},
    field: `
    collection: perps_collection {
      makerFeeBps
      takerFeeBps
      minimumMarginPerOrder
      minimumPriceIncrement
      totalVolume
    }`,
  },

  // --- market ------------------------------------------------------------

  book: {
    alias: "book",
    group: "market",
    cacheKey: `["PerpsOrderBook"]`,
    vars: { bookFirst: "Int!", bookLastId: "ID!" },
    field: `
    book: priceLevels(
      first: $bookFirst
      where: { id_gt: $bookLastId, orderCount_gte: 1 }
      orderBy: id
      orderDirection: asc
    ) {
      ${PERPS_PRICE_LEVEL_FIELDS}
    }`,
  },

  recentTrades: commonSlices.recentTrades,

  /** The newest funding update; the rate shown in the header. */
  funding: {
    alias: "funding",
    group: "market",
    cacheKey: `["FundingRate"]`,
    vars: {},
    field: `
    funding: fundingUpdates(first: 1, orderBy: timestamp, orderDirection: desc) {
      blockNumber
      cumulativeFundingPerUnit
      fundingRate
      id
      timestamp
      transactionHash
    }`,
  },

  // --- account -----------------------------------------------------------

  myOrders: {
    alias: "myOrders",
    group: "account",
    cacheKey: `["UserPerpsOrders", address, statuses]`,
    vars: { address: "ID!", statuses: "[String!]!" },
    field: `
    myOrders: orders(where: { user: $address, status_in: $statuses }) {
      ${PERPS_ORDER_FIELDS}
    }`,
  },

  /** Every session, open or closed — the perps positions tab shows both. */
  sessions: {
    alias: "sessions",
    group: "account",
    cacheKey: `["UserPositionSessions", address]`,
    vars: { address: "ID!", sessionFirst: "Int!" },
    field: `
    sessions: positionSessions(
      where: { user: $address }
      orderBy: openedAt
      orderDirection: desc
      first: $sessionFirst
    ) {
      ${PERPS_POSITION_SESSION_FIELDS}
    }`,
  },

  liquidations: {
    alias: "liquidations",
    group: "account",
    cacheKey: `["UserLiquidations", "perpetual", address]`,
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

  /**
   * One row serving three readers: open exposure, realized PnL and the
   * account's net position. Perps has a single instrument, so the indexer keeps
   * the running net quantity and average entry on `User` directly.
   */
  me: {
    alias: "me",
    group: "account",
    cacheKey: `["PortfolioOpenExposure", "perpetual", address]`,
    vars: { address: "ID!" },
    field: `
    me: user(id: $address) {
      netQuantity
      aggregatedEntryPrice
      realizedPnl
    }`,
  },

  realizedBaseline: commonSlices.realizedBaseline,

  // --- history -----------------------------------------------------------

  historyOrders: {
    alias: "historyOrders",
    group: "history",
    cacheKey: `["PerpsOrderHistory", address]`,
    vars: { address: "ID!", excludeStatuses: "[String!]!", historyFirst: "Int!", historySkip: "Int!" },
    field: `
    historyOrders: orders(
      where: { user: $address, status_not_in: $excludeStatuses }
      orderBy: createdAt
      orderDirection: desc
      first: $historyFirst
      skip: $historySkip
    ) {
      ${PERPS_ORDER_FIELDS}
    }`,
  },

  historyPositions: {
    alias: "historyPositions",
    group: "history",
    cacheKey: `["PerpsPositionHistory", address]`,
    vars: { address: "ID!", historyFirst: "Int!", historySkip: "Int!" },
    field: `
    historyPositions: positionSessions(
      where: { user: $address, status: CLOSE }
      orderBy: lastTradeAt
      orderDirection: desc
      first: $historyFirst
      skip: $historySkip
    ) {
      ${PERPS_POSITION_SESSION_FIELDS}
    }`,
  },

  /**
   * Fills for named sessions, for the trade-details modal. The only path by
   * which fills reach the UI; the session slices carry one row for direction
   * and nothing more.
   */
  sessionTrades: {
    alias: "sessionTrades",
    group: "history",
    cacheKey: `["PerpsSessionTrades", ids]`,
    vars: { sessionIds: "[ID!]!" },
    field: `
    sessionTrades: positionSessions(where: { id_in: $sessionIds }) {
      id
      trades {
        ${PERPS_SESSION_TRADE_FIELDS}
      }
    }`,
  },

  historyTrades: {
    alias: "historyTrades",
    group: "history",
    cacheKey: `["UserTrades", address]`,
    vars: { address: "ID!", historyFirst: "Int!", historySkip: "Int!" },
    field: `
    historyTrades: trades(
      where: { user: $address }
      orderBy: timestamp
      orderDirection: desc
      first: $historyFirst
      skip: $historySkip
    ) {
      user {
        id
      }
      transactionHash
      aggregatedEntryPriceAfter
      blockNumber
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
    }`,
  },
}) satisfies Record<string, Slice>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const PerpsCollectionQuery = buildDocument("PerpsCollection", [perpsSlices.collection]);

export const PerpsOrderBookQuery = buildDocument("PerpsOrderBook", [perpsSlices.book]);

export const FundingUpdatesQuery = buildDocument("FundingUpdates", [perpsSlices.funding]);

export const UserPerpsOrdersByStatusQuery = buildDocument("UserPerpsOrdersByStatus", [
  perpsSlices.myOrders,
]);

export const UserPositionSessionsQuery = buildDocument("UserPositionSessions", [
  perpsSlices.sessions,
]);

export const UserPerpsLiquidationsQuery = buildDocument("UserPerpsLiquidations", [
  perpsSlices.liquidations,
]);

/** Open perps exposure. A subset of `me`, so it reuses the same slice. */
export const PerpsOpenExposureQuery = buildDocument("PerpsOpenExposure", [perpsSlices.me]);

export const UserPerpsOrdersExcludeStatusQuery = buildDocument("UserPerpsOrdersExcludeStatus", [
  perpsSlices.historyOrders,
]);

export const UserClosedPositionSessionsQuery = buildDocument("UserClosedPositionSessions", [
  perpsSlices.historyPositions,
]);

export const UserTradesQuery = buildDocument("UserTrades", [perpsSlices.historyTrades]);

export const PerpsSessionTradesQuery = buildDocument("PerpsSessionTrades", [
  perpsSlices.sessionTrades,
]);
