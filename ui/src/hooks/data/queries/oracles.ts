import { gql } from "graphql-request";
import { defineSlices, type Slice } from "./slice";

/**
 * The oracle subgraph: hashprice, BTC price and network hashrate.
 *
 * The documents that fetch a whole range are plain `gql`: each is fetched once
 * per range and has no batched twin to drift from, and `OracleHourCandlesQuery`
 * is already a hand-merged batch of the three series.
 *
 * The *overlay* slices at the bottom are assembled per tick, because which
 * series they carry depends on which are switched on in the chart legend.
 */

/** Raw per-tick hashprice, for ranges too short to have candles. */
export const HashrateIndexQuery = gql`
  query HashpriceIndex($startDate: BigInt!, $cursor: BigInt!, $first: Int!) {
    hashpriceUsds(
      where: { timestamp_gte: $startDate, timestamp_lt: $cursor }
      orderBy: timestamp
      orderDirection: desc
      first: $first
    ) {
      blockNumber
      id
      price
      timestamp
    }
  }
`;

export const BtcPriceIndexQuery = gql`
  query BtcPriceIndex($startDate: BigInt!, $cursor: BigInt!, $first: Int!) {
    btcUsds(
      where: { timestamp_gte: $startDate, timestamp_lt: $cursor }
      orderBy: timestamp
      orderDirection: desc
      first: $first
    ) {
      blockNumber
      id
      price
      timestamp
    }
  }
`;

// Difficulty-implied Bitcoin network hashrate in hashes/second, served by the
// same oracle subgraph as the price feeds and with the same timeseries/candle
// shape. Difficulty only retargets every ~2016 blocks, so the series is a step
// function that stays flat within an epoch.
// The oracle subgraph publishes the network hashrate over two trailing windows,
// 144 blocks (~1 day) and 1008 blocks (~7 days). We read the 7-day series: block
// discovery is Poisson, so a 1-day estimate carries roughly 8% standard error
// against 3% for the 7-day one, and the shorter series mostly plots mining luck.
export const NetworkHashrateIndexQuery = gql`
  query NetworkHashrateIndex($startDate: BigInt!, $cursor: BigInt!, $first: Int!) {
    networkHashrate7Ds(
      where: { timestamp_gte: $startDate, timestamp_lt: $cursor }
      orderBy: timestamp
      orderDirection: desc
      first: $first
    ) {
      blockNumber
      id
      hashrateHpS
      timestamp
    }
  }
`;

/**
 * All three hourly series in one request.
 *
 * The three charts asked for the same hour buckets with start timestamps that
 * differed by a millisecond, so they never shared a cache entry and always cost
 * three requests. `fetchOracleHourCandles` floors the start to the hour and
 * coalesces them onto this.
 */
export const OracleHourCandlesQuery = gql`
  query OracleHourCandlesQuery(
    $interval: String!
    $first: Int!
    $startTimestamp: BigInt!
    $current: Aggregation_current
  ) {
    hashpriceUsdCandles(
      interval: $interval
      first: $first
      current: $current
      orderBy: timestamp
      orderDirection: desc
      where: { timestamp_gte: $startTimestamp }
    ) {
      id
      open
      high
      low
      close
      sum
      count
      timestamp
    }
    btcUsdCandles(
      interval: $interval
      first: $first
      current: $current
      orderBy: timestamp
      orderDirection: desc
      where: { timestamp_gte: $startTimestamp }
    ) {
      count
      id
      sum
      timestamp
    }
    networkHashrate7DCandles(
      interval: $interval
      first: $first
      current: $current
      orderBy: timestamp
      orderDirection: desc
      where: { timestamp_gte: $startTimestamp }
    ) {
      count
      id
      sum
      timestamp
    }
  }
`;

// ---------------------------------------------------------------------------
// Overlay slices: the bar in progress
// ---------------------------------------------------------------------------
//
// The charts bucket their range into bars, and only the newest one can still
// change. These read that one bar, so it can be kept live on a short interval
// without re-reading the range behind it. See `lib/chartOverlay.ts`.
//
// One slice per series and per source, assembled into a document from whichever
// series the legend currently shows — a series that is switched off is not in
// the request at all.

const TICK_ARGS = `
  where: { timestamp_gte: $bucketStart }
  orderBy: timestamp
  orderDirection: desc
  first: $bucketFirst
`;

const hourArgs = (extra = "") => `
    interval: "hour"
    first: $bucketFirst
    current: $current
    orderBy: timestamp
    orderDirection: desc
    where: { timestamp_gte: $bucketStart }${extra}
`;

const TICK_VARS = { bucketStart: "BigInt!", bucketFirst: "Int!" } as const;
const HOUR_VARS = {
  bucketStart: "BigInt!",
  bucketFirst: "Int!",
  current: "Aggregation_current",
} as const;

/**
 * `1d` buckets raw ticks; `5d` and `1m` bucket hourly aggregations. Which of the
 * two a range uses is `chartRangeSpec(range).source`.
 */
export const oracleOverlaySlices = defineSlices({
  hashpriceUsds: {
    alias: "hashpriceUsds",
    group: "market",
    cacheKey: `["hashpriceChart", range]`,
    vars: TICK_VARS,
    field: `
    hashpriceUsds(${TICK_ARGS}) {
      id
      price
      timestamp
    }`,
  },

  btcUsds: {
    alias: "btcUsds",
    group: "market",
    cacheKey: `["btcPriceIndex", range]`,
    vars: TICK_VARS,
    field: `
    btcUsds(${TICK_ARGS}) {
      id
      price
      timestamp
    }`,
  },

  networkHashrate7Ds: {
    alias: "networkHashrate7Ds",
    group: "market",
    cacheKey: `["networkHashrateIndex", range]`,
    vars: TICK_VARS,
    field: `
    networkHashrate7Ds(${TICK_ARGS}) {
      id
      hashrateHpS
      timestamp
    }`,
  },

  /// Carries OHLC on top of the shared sum/count, for the candlestick mode.
  hashpriceUsdCandles: {
    alias: "hashpriceUsdCandles",
    group: "market",
    cacheKey: `["hashpriceChart", range]`,
    vars: HOUR_VARS,
    field: `
    hashpriceUsdCandles(${hourArgs()}) {
      id
      open
      high
      low
      close
      sum
      count
      timestamp
    }`,
  },

  btcUsdCandles: {
    alias: "btcUsdCandles",
    group: "market",
    cacheKey: `["btcPriceIndex", range]`,
    vars: HOUR_VARS,
    field: `
    btcUsdCandles(${hourArgs()}) {
      count
      id
      sum
      timestamp
    }`,
  },

  networkHashrate7DCandles: {
    alias: "networkHashrate7DCandles",
    group: "market",
    cacheKey: `["networkHashrateIndex", range]`,
    vars: HOUR_VARS,
    field: `
    networkHashrate7DCandles(${hourArgs()}) {
      count
      id
      sum
      timestamp
    }`,
  },
}) satisfies Record<string, Slice>;
