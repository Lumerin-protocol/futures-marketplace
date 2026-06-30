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
query UserPerpsOrdersExcludeStatus ($address: ID!, $statuses: [String!]!)  {
  orders(
    where: { user: $address, status_not_in: $statuses }
    orderBy: createdAt
    orderDirection: desc
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

export const UserPerpsTradesQuery = gql`
    query UserPerpsTrades  ($address: ID!){
  trades(
    where: {
      or: [
        { buyer: $address }
        { seller: $address }
      ]
    }
  ) {
    blockNumber
    makerOrderId
    id
    price
    quantity
    timestamp
    transactionHash
    volume
    seller {
      id
    }
    buyer {
      id
    }
  }
}`

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
    positionSessions(where: { user: $address }) {
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
  query UserTrades($address: ID!) {
    trades(where: { user: $address }, orderBy: timestamp, orderDirection: desc) {
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
      marginPercent
      maintenanceMarginPercent
      totalVolume
    }
  }
`