import { gql } from "graphql-request";

/**
 * PnL-only documents for the portfolio header. They are deliberately narrow: the
 * header aggregates every venue on every page, so it cannot afford the fat
 * position/trade payloads the per-venue tabs pull.
 */

/**
 * Lifetime realized PnL plus the baseline for the trailing window.
 *
 * Runs unchanged against every venue's subgraph — `User.realizedPnl` and
 * `Trade.cumulativeRealizedPnl` are part of the schema both the futures and the
 * perps indexers converged on. `trades` returns the newest trade *before* the
 * window, so subtracting its snapshot leaves what the window itself produced.
 * Two rows, whatever the size of the account's history.
 */
export const VenueRealizedPnlQuery = gql`
  query VenueRealizedPnl($address: ID!, $cutoff: BigInt!) {
    user(id: $address) {
      realizedPnl
    }
    trades(
      where: { user: $address, timestamp_lt: $cutoff }
      orderBy: timestamp
      orderDirection: desc
      first: 1
    ) {
      cumulativeRealizedPnl
    }
  }
`;

/**
 * Open futures exposure, one row per expiration the account is still in.
 *
 * `expiration` is a nullable add-on to `PositionSession`, so its settlement
 * price has to be guarded. When present it freezes the leg's PnL.
 */
export const FuturesOpenExposureQuery = gql`
  query FuturesOpenExposure($address: ID!, $first: Int!) {
    positionSessions(where: { user: $address, status: OPEN }, first: $first) {
      id
      netQuantity
      entryPrice
      expirationAt
      expiration {
        settlementPrice
      }
    }
  }
`;

/**
 * Open perps exposure. Perps has a single instrument, so the indexer already
 * keeps the account's net quantity and average entry on `User` — no per-session
 * aggregation needed on the client.
 */
export const PerpsOpenExposureQuery = gql`
  query PerpsOpenExposure($address: ID!) {
    user(id: $address) {
      netQuantity
      aggregatedEntryPrice
    }
  }
`;
