import { gql } from "graphql-request";

export const PerpsOrderBookQuery = gql`
  query PerpsOrderBookQuery($first: Int!, $lastId: ID!) {
    priceLevels(
      first: $first
      where: { id_gt: $lastId, orderCount_gte: 1 }
      orderBy: id
      orderDirection: asc
    ) {
      id
      isBid
      orderCount
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

export const UserPerpsOrdersQuery = gql`
query UserPerpsOrders ($address: ID!)  {
  orders(where: { user: $address }) {
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
  }
  _meta {
      block {
        number
        timestamp
      }
    }
}
    `

export const UserPerpsOrdersByStatusQuery = gql`
query UserPerpsOrdersByStatus ($address: ID!, $statuses: [String!]!)  {
  orders(where: { user: $address, status_in: $statuses }) {
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
  }
  _meta {
      block {
        number
        timestamp
      }
    }
}
    `

export const UserPerpsOrdersExcludeStatusQuery = gql`
query UserPerpsOrdersExcludeStatus ($address: ID!, $statuses: [String!]!, $first: Int, $skip: Int)  {
  orders(
    where: { user: $address, status_not_in: $statuses }
    orderBy: createdAt
    orderDirection: desc
    first: $first
    skip: $skip
  ) {
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
  }
  _meta {
      block {
        number
        timestamp
      }
    }
}
    `

export const FundingUpdatesQuery = gql`
  query FundingUpdates {
    fundingUpdates(
      first: 1
      orderBy: timestamp
      orderDirection: desc
    ) {
      blockNumber
      cumulativeFundingPerUnit
      fundingRate
      id
      timestamp
      transactionHash
    }
  }
`

export const UserPositionSessionsQuery = gql`
  query UserPositionSessions($address: ID!) {
    positionSessions(
      where: { user: $address }
      orderBy: openedAt
      orderDirection: desc
      first: 100
    ) {
      closePrice
      entryPrice
      closedQuantity
      liquidatedQuantity
      fundingFees
      id
      lastTradeAt
      maxQuantity
      openedAt
      realizedPnl
      status
      tradingFees
      user {
        id
        netQuantity
      }
      trades {
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
      }
    }
  }
`

// Closed PositionSessions for a user, paged with first/skip and ordered
// newest-first. Powers the perps Position History "Load More" table — the open
// Positions tab keeps using the unfiltered `UserPositionSessionsQuery`.
export const UserClosedPositionSessionsQuery = gql`
  query UserClosedPositionSessions($address: ID!, $first: Int!, $skip: Int!) {
    positionSessions(
      where: { user: $address, status: CLOSE }
      orderBy: lastTradeAt
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      closePrice
      entryPrice
      closedQuantity
      liquidatedQuantity
      fundingFees
      id
      lastTradeAt
      maxQuantity
      openedAt
      realizedPnl
      status
      tradingFees
      user {
        id
        netQuantity
      }
      trades {
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
      }
    }
  }
`

export const UserTradesQuery = gql`
  query UserTrades($address: ID!, $first: Int!, $skip: Int!) {
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
    }
  }
`

export const PerpsCollectionQuery = gql`
  query PerpsCollection {
    perps_collection {
      makerFeeBps
      takerFeeBps
      minimumMarginPerOrder
      minimumPriceIncrement
      totalVolume
    }
  }
`