import { defineSlices, type Slice } from "./slice";

/**
 * Slices valid against **both** venue subgraphs.
 *
 * The futures and perps indexers converged on the same `User` and `Trade`
 * entities, so these render identically for either endpoint. They are defined
 * once here and imported by both venue files rather than copied, which is the
 * same reason slices exist at all.
 */

const RECENT_TRADE_FIELDS = `
  id
  tradePrice
  tradeQuantity
  timestamp
  transactionHash
  isLiquidation
  isBackstopAssignment
  user {
    id
  }
`;

/**
 * A session's liquidation fees, for netting out of its realized PnL.
 *
 * `PositionSession.tradingFees` leaves them out: the indexer books them on the
 * forced-close trade. Filtered to trades that actually paid one, so a session
 * that was never liquidated carries an empty list.
 */
export const SESSION_LIQUIDATION_FEES = `
  liquidationFees: trades(where: { liquidationFee_gt: "0" }) {
    liquidationFee
  }
`;

export const commonSlices = defineSlices({
  /** The venue-wide fill feed behind the order book's "Trades" tab. */
  recentTrades: {
    alias: "recentTrades",
    group: "market",
    cacheKey: `["RecentTrades", venue, 50]`,
    vars: { tradesFirst: "Int!" },
    field: `
    recentTrades: trades(
      first: $tradesFirst
      orderBy: timestamp
      orderDirection: desc
    ) {
      ${RECENT_TRADE_FIELDS}
    }`,
  },

  /** Lifetime realized PnL for the account, on this venue. */
  me: {
    alias: "me",
    group: "account",
    cacheKey: `["PortfolioRealizedPnl", venue, address, cutoff]`,
    vars: { address: "ID!" },
    field: `
    me: user(id: $address) {
      realizedPnl
    }`,
  },

  /**
   * The newest fill *before* the trailing window, whose running total is
   * subtracted from `me.realizedPnl` to leave what the window itself produced.
   * One row, whatever the size of the account's history.
   */
  realizedBaseline: {
    alias: "realizedBaseline",
    group: "account",
    cacheKey: `["PortfolioRealizedPnl", venue, address, cutoff]`,
    vars: { address: "ID!", cutoff: "BigInt!" },
    field: `
    realizedBaseline: trades(
      where: { user: $address, timestamp_lt: $cutoff }
      orderBy: timestamp
      orderDirection: desc
      first: 1
    ) {
      cumulativeRealizedPnl
    }`,
  },

  /**
   * The window's fees, summed on the client and taken out of the realized
   * figure: the indexer keeps no running fee total to subtract the way
   * `realizedBaseline` serves the PnL itself. Maker fills are free at current
   * rates and fall outside the filter, so the rows are the account's taker
   * fills and forced closes rather than every trade it made.
   *
   * graph-node refuses `or` beside other filters at the same level, hence the
   * repeated branches. Paged by id from `$feesAfterId`; see `pnl/windowFees.ts`.
   */
  feesInWindow: {
    alias: "feesInWindow",
    group: "account",
    cacheKey: `["PortfolioRealizedPnl", venue, address, cutoff]`,
    vars: { address: "ID!", cutoff: "BigInt!", feesFirst: "Int!", feesAfterId: "Bytes!" },
    field: `
    feesInWindow: trades(
      where: {
        or: [
          { user: $address, timestamp_gte: $cutoff, tradingFee_not: "0", id_gt: $feesAfterId }
          { user: $address, timestamp_gte: $cutoff, liquidationFee_gt: "0", id_gt: $feesAfterId }
        ]
      }
      orderBy: id
      orderDirection: asc
      first: $feesFirst
    ) {
      id
      tradingFee
      liquidationFee
    }`,
  },
}) satisfies Record<string, Slice>;
