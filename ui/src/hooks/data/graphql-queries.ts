import { gql } from "graphql-request";

// Per-user futures Orders, paged with first/skip and filtered by status + future expirationAt.
// Mirrors the perps `UserPerpsOrdersByStatusQuery` shape (the futures Order entity exposes
// the same fields plus `expirationAt`).
export const UserFuturesOrdersByStatusQuery = gql`
  query UserFuturesOrdersByStatus(
    $address: ID!
    $statuses: [String!]!
    $now: BigInt!
    $first: Int!
    $skip: Int!
  ) {
    orders(
      where: { user: $address, status_in: $statuses, expirationAt_gt: $now }
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
// The futures schema replaces the legacy `Position` book with per-(user, expirationAt) sessions
// that aggregate the user's trades; the UI collapses each session into a single
// PositionBookPosition row downstream so consumers keep working.
export const PositionsBookQuery = gql`
  query PositionsBookQuery($address: ID!) {
    positionSessions(where: { user: $address, netQuantity_not: 0 }) {
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
      trades {
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

export const AggregateOrderBookQuery = gql`
  query AggregateOrderBookQuery($expirationAt: BigInt!, $first: Int!, $lastId: ID!) {
    priceLevels(
      first: $first
      where: { expirationAt: $expirationAt, id_gt: $lastId, totalQuantity_gte: 1 }
      orderBy: id
      orderDirection: asc
    ) {
      id
      isBid
      expirationAt
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
      priceOracle
      minimumPriceIncrement
      contractSizeHpsDay
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

// Historical (closed) PositionSessions, paged with first/skip and ordered
// newest-first. Mirrors the active `PositionsBookQuery` shape — the only
// difference is the `status: CLOSE` filter. Incremental "Load More" pagination
// reaches arbitrarily far back, so there is no time-window cutoff.
export const HistoricalPositionsQuery = gql`
  query HistoricalPositionsQuery($address: ID!, $first: Int!, $skip: Int!) {
    positionSessions(
      where: { user: $address, status: CLOSE }
      first: $first
      skip: $skip
      orderBy: lastTradeAt
      orderDirection: desc
    ) {
      closePrice
      closedQuantity
      liquidatedQuantity
      expirationAt
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

// Historical (closed) Orders, paged with first/skip and ordered newest-first.
// Mirrors the active `UserFuturesOrdersByStatusQuery` shape — the only
// difference is the status filter (terminal states). Incremental "Load More"
// pagination reaches arbitrarily far back, so there is no time-window cutoff.
export const HistoricalOrdersQuery = gql`
  query HistoricalOrdersQuery($address: ID!, $first: Int!, $skip: Int!) {
    orders(
      where: {
        user: $address
        status_in: ["FILLED", "CANCELLED", "LIQUIDATED", "EXPIRED"]
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
      # Populated only when a keeper force-cancelled the order (status LIQUIDATED).
      liquidator
      liquidationFee
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

// All-users recent Trades feed for the order book "Trades" tab. Works against
// both the futures and perps subgraphs since both expose the per-user `Trade`
// entity with a signed `tradeQuantity` (positive = buy/long, negative =
// sell/short), `tradePrice`, `timestamp` and `transactionHash`.
export const RecentTradesQuery = gql`
  query RecentTrades($first: Int!) {
    trades(orderBy: timestamp, orderDirection: desc, first: $first) {
      id
      tradePrice
      tradeQuantity
      timestamp
      transactionHash
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
// The futures Trade entity additionally carries `expirationAt`, which the perps
// one has no equivalent for.
export const UserFuturesTradesQuery = gql`
  query UserFuturesTrades($address: ID!, $first: Int!, $skip: Int!) {
    trades(
      where: { user: $address }
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
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
    }
  }
`;
