import {
  candlesFromTicks,
  mapHashpriceCandles,
  rollupHashpriceCandles,
  subgraphTimestampToMs,
  type HashpriceCandle,
  type SubgraphHashpriceCandle,
} from "../../lib/chartCandles";
import {
  chartRangeSpec,
  rollupAverageTicks,
  startMicrosForRange,
  type AverageTick,
  type TimePeriod,
} from "../../lib/chartBars";
import { graphqlRequest } from "./graphql";
import { HashpriceCandlesQuery, HashrateIndexQuery } from "./graphql-queries";
import { paginateOracleTicks } from "./paginateOracleTicks";
import { prefetchSeed, withSeedFallback } from "./seed-utils";
import { hourAggToAverageTick, type HourAggRow } from "./fetchOracleHourAverages";

const PRICE_SCALE = 10 ** 8;
const HOUR_PAGE_SIZE = 1000;

const loadHashpriceUsdsSeed = () =>
  import(/* webpackChunkName: "seed-hashprice-usds" */ "../../seed/hashpriceUsds.json").then((m) => m.default);

export const HASHPRICE_CHART_QK = "hashpriceChart";

export type HashrateIndexPoint = {
  updatedAt: number;
  updatedAtDate: Date;
  id: string;
  priceToken: number;
};

export type HashpriceChartData = {
  line: HashrateIndexPoint[];
  candles: HashpriceCandle[];
};

type HashrateIndexItem = {
  blockNumber?: string;
  price: string;
  timestamp: string;
  id: string | number;
};

type HourOhlcRow = SubgraphHashpriceCandle & HourAggRow;

const lineFromAverages = (rows: AverageTick[], intervalMs: number): HashrateIndexPoint[] =>
  rollupAverageTicks(rows, intervalMs).map((bucket) => ({
    updatedAt: bucket.timeMs,
    updatedAtDate: new Date(bucket.timeMs),
    id: bucket.id,
    priceToken: bucket.sum / bucket.count / PRICE_SCALE,
  }));

/**
 * 1D reads one page of ticks (15m bars). 5D/1M use Goldsky hourly candles so we
 * do not page tens of thousands of ticks. 1M is rolled to 12h in the client.
 */
export async function fetchHashpriceChart(timePeriod: TimePeriod): Promise<HashpriceChartData> {
  const spec = chartRangeSpec(timePeriod);
  const startMicros = startMicrosForRange(timePeriod);

  if (spec.source === "tick") {
    const seedPromise = prefetchSeed("hashpriceUsds", loadHashpriceUsdsSeed);
    let ticks = await paginateOracleTicks<HashrateIndexItem>(HashrateIndexQuery, "hashpriceUsds", startMicros);
    ticks = await withSeedFallback(ticks, seedPromise, BigInt(startMicros));
    ticks = ticks.filter((item) => BigInt(item.timestamp) >= BigInt(startMicros));

    const averages: AverageTick[] = ticks.map((item) => ({
      id: String(item.id),
      timeMs: subgraphTimestampToMs(item.timestamp),
      sum: Number(item.price),
      count: item.price === "0" ? 0 : 1,
    }));

    return {
      line: lineFromAverages(averages, spec.intervalMs),
      candles: candlesFromTicks(
        ticks.map((item) => ({
          id: item.id,
          timeMs: subgraphTimestampToMs(item.timestamp),
          price: Number(item.price) / PRICE_SCALE,
        })),
        spec.intervalMs,
      ),
    };
  }

  const req = await graphqlRequest<{ hashpriceUsdCandles: HourOhlcRow[] }>(
    HashpriceCandlesQuery,
    { interval: "hour", first: HOUR_PAGE_SIZE, startTimestamp: startMicros },
    process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
  );
  const start = BigInt(startMicros);
  const rows = (req.hashpriceUsdCandles ?? []).filter((row) => BigInt(row.timestamp) >= start);

  return {
    line: lineFromAverages(rows.map(hourAggToAverageTick), spec.intervalMs),
    candles: rollupHashpriceCandles(mapHashpriceCandles(rows), spec.intervalMs),
  };
}
