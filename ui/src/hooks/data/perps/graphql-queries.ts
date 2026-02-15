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
      _or: [
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