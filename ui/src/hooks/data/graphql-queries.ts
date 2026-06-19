import { gql } from "graphql-request";

// Per-user futures Orders, paged with first/skip and filtered by status + future deliveryAt.
// Mirrors the perps `UserPerpsOrdersByStatusQuery` shape (the futures Order entity exposes
// the same fields plus `deliveryAt`).
export const UserFuturesOrdersByStatusQuery = gql`
  query UserFuturesOrdersByStatus(
    $address: ID!
    $statuses: [String!]!
    $now: BigInt!
    $first: Int!
    $skip: Int!
  ) {
    orders(
      where: { user: $address, status_in: $statuses, deliveryAt_gt: $now }
      first: $first
      skip: $skip
      orderBy: createdAt
      orderDirection: desc
    ) {
      user {
        id
      }
      blockNumber
      cancelledQuantity
      closedAt
      deliveryAt
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
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

// Per-user PositionSessions for futures, mirroring the perps `UserPositionSessionsQuery`.
// The futures schema replaces the legacy `Position` book with per-(user, deliveryAt) sessions
// that aggregate the user's trades; the UI collapses each session into a single
// PositionBookPosition row downstream so consumers keep working.
export const PositionsBookQuery = gql`
  query PositionsBookQuery($address: ID!) {
    positionSessions(where: { user: $address, netQuantity_not: 0 }) {
      closePrice
      closedQuantity
      deliveryAt
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
      trades {
        blockNumber
        deliveryAt
        fillCount
        id
        netQuantityAfter
        realizedPnl
        timestamp
        tradePrice
        tradeQuantity
        tradingFee
        transactionHash
      }
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

export const OrderBookQuery = gql`
  query OrderBook($deliveryAt: BigInt!) {
    orders(where: { deliveryAt: $deliveryAt, isActive: true }) {
      id
      pricePerDay
      deliveryAt
      participant {
        address
      }
      isBuy,
      isActive
    },
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

export const AggregateOrderBookQuery = gql`
  query AggregateOrderBookQuery($deliveryAt: BigInt!, $first: Int!, $lastId: ID!) {
    priceLevels(
      first: $first
      where: { deliveryAt: $deliveryAt, id_gt: $lastId, totalQuantity_gte: 1 }
      orderBy: id
      orderDirection: asc
    ) {
      id
      isBid
      deliveryAt
      price
      totalQuantity
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

export const ContractSpecsQuery = gql`
  query ContractSpecs {
    futures(id: "0") {
      deliveryDurationDays
      liquidationMarginPercent
      hashrateOracleAddress
      minimumPriceIncrement
      speedHps
      contractAddress
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

export const HashrateIndexQuery = gql`
  query HashpriceIndex($startDate: BigInt!, $first: Int!, $skip: Int!) {
    hashpriceUsds(
      where: { timestamp_gte: $startDate }
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      blockNumber
      id
      price
      timestamp
    }
  }
`;

export const AggregatedHashrateIndexQuery = gql`
  query AggregatedHashrateIndexQuery($interval: String!, $first: Int!, $skip: Int!, $startTimestamp: BigInt!) {
  hashpriceUsdCandles(interval: $interval, first: $first, skip: $skip, where: { timestamp_gte: $startTimestamp }) {
    count
    id
    sum
    timestamp
  }
}`;

// Historical (closed) PositionSessions for the last 30 days, paged with first/skip.
// Mirrors the active `PositionsBookQuery` shape — the only difference is the
// `status: CLOSE` filter and the `lastTradeAt_gte` cutoff.
export const HistoricalPositionsQuery = gql`
  query HistoricalPositionsQuery($address: ID!, $thirtyDaysAgo: BigInt!, $first: Int!, $skip: Int!) {
    positionSessions(
      where: { user: $address, status: CLOSE, lastTradeAt_gte: $thirtyDaysAgo }
      first: $first
      skip: $skip
      orderBy: lastTradeAt
      orderDirection: desc
    ) {
      closePrice
      closedQuantity
      deliveryAt
      entryPrice
      id
      lastTradeAt
      maxQuantity
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
      trades {
        blockNumber
        deliveryAt
        fillCount
        id
        netQuantityAfter
        realizedPnl
        timestamp
        tradePrice
        tradeQuantity
        tradingFee
        transactionHash
      }
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

// Historical (closed) Orders for the last 30 days, paged with first/skip.
// Mirrors the active `UserFuturesOrdersByStatusQuery` shape — the only difference
// is the status filter (terminal states) and the deliveryAt cutoff.
export const HistoricalOrdersQuery = gql`
  query HistoricalOrdersQuery($address: ID!, $thirtyDaysAgo: BigInt!, $first: Int!, $skip: Int!) {
    orders(
      where: {
        user: $address
        status_in: ["FILLED", "PARTIALLY_FILLED", "CANCELLED"]
        deliveryAt_gte: $thirtyDaysAgo
      }
      first: $first
      skip: $skip
      orderBy: createdAt
      orderDirection: desc
    ) {
      user {
        id
      }
      blockNumber
      cancelledQuantity
      closedAt
      deliveryAt
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
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

// BTC Price Oracle queries (similar to Hashrate Index)
export const BtcPriceIndexQuery = gql`
  query BtcPriceIndex($startDate: BigInt!, $first: Int!, $skip: Int!) {
    btcUsds(
      where: { timestamp_gte: $startDate }
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      blockNumber
      id
      price
      timestamp
    }
  }
`;

export const AggregatedBtcPriceIndexQuery = gql`
  query AggregatedBtcPriceIndexQuery($interval: String!, $first: Int!, $skip: Int!, $startTimestamp: BigInt!) {
    btcUsdCandles(interval: $interval, first: $first, skip: $skip, where: { timestamp_gte: $startTimestamp }) {
      count
      id
      sum
      timestamp
    }
  }
`;

// Per-user futures Trades, mirroring the perps `UserTradesQuery` shape.
// The futures Trade entity has no `aggregatedEntryPriceAfter` (perps-only)
// but does carry `deliveryAt` and `fillCount` (futures-only).
export const UserFuturesTradesQuery = gql`
  query UserFuturesTrades($address: ID!) {
    trades(where: { user: $address }, orderBy: timestamp, orderDirection: desc) {
      user {
        id
      }
      transactionHash
      blockNumber
      deliveryAt
      fillCount
      id
      netQuantityAfter
      realizedPnl
      timestamp
      tradePrice
      tradeQuantity
      tradingFee
    }
  }
`;
