import { gql } from "graphql-request";

export const PerpsOrderBookQuery = gql`
  query PerpsOrderBookQuery{
    priceLevels {
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


export const UserPositionSnapshotsQuery = gql`
 query UserPositionSnapshots ($address: ID!) {
        positionSnapshots (where: { user: $address }) {
          aggregatedEntryPriceAfter
          blockNumber
          id
          netQuantityAfter
          timestamp
          tradePrice
          tradeQuantity
          transactionHash
          user {
            id
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
    }
  }
`