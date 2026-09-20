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
}) satisfies Record<string, Slice>;
