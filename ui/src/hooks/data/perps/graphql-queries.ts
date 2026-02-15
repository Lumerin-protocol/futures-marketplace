import { gql } from "graphql-request";

export const PerpsOrderBookQuery = gql`
  query PerpsOrderBookQuery {
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