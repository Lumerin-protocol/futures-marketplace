import {
  candlesFromTicks,
  mapHashpriceCandles,
  rollupHashpriceCandles,
  subgraphTimestampToMs,
  type HashpriceCandle,
} from "../../lib/chartCandles";
import {
  chartRangeSpec,
  rollupAverageTicks,
  startMicrosForRange,
  type AverageTick,
  type TimePeriod,
} from "../../lib/chartBars";
import { HashrateIndexQuery } from "./queries/oracles";
import { paginateOracleTicks } from "./paginateOracleTicks";
import { prefetchSeed, withSeedFallback } from "./seed-utils";
import {
  fetchOracleHourCandles,
  hourAggToAverageTick,
  oracleTickToAverage,
} from "./fetchOracleHourAverages";

const PRICE_SCALE = 10 ** 8;

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

/** One tick as a point on the candlestick series. */
export const hashpriceTickToPrice = (item: { id: string | number; price: string; timestamp: string }) => ({
  id: item.id,
  timeMs: subgraphTimestampToMs(item.timestamp),
  price: Number(item.price) / PRICE_SCALE,
});

/**
 * Bucket samples into the chart's bars.
 *
 * Exported, like its two counterparts on the other series, so the overlay that
 * keeps the newest bar current builds it exactly as the range behind it does.
 */
export const hashpriceLineFromAverages = (rows: AverageTick[], intervalMs: number): HashrateIndexPoint[] =>
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

    return {
      line: hashpriceLineFromAverages(
        ticks.map((item) => oracleTickToAverage(item, item.price)),
        spec.intervalMs,
      ),
      candles: candlesFromTicks(ticks.map(hashpriceTickToPrice), spec.intervalMs),
    };
  }

  const req = await fetchOracleHourCandles(startMicros);
  const start = BigInt(startMicros);
  const rows = (req.hashpriceUsdCandles ?? []).filter((row) => BigInt(row.timestamp) >= start);

  return {
    line: hashpriceLineFromAverages(rows.map(hourAggToAverageTick), spec.intervalMs),
    candles: rollupHashpriceCandles(mapHashpriceCandles(rows), spec.intervalMs),
  };
}
