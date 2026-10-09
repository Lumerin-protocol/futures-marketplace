/**
 * Keeps the bar in progress current on each of the index charts.
 *
 * The charts fetch their whole range once and hold it for a bar interval, so on
 * 5D a new oracle post could go unseen for an hour. This re-reads just the
 * newest bar — a few hundred bytes — and splices it over the cached range, so
 * every series is at most one tick behind the indexer.
 *
 * Only the series currently switched on in the chart legend are in the request.
 */

import type { QueryClient } from "@tanstack/react-query";
import { chartRangeSpec, type TimePeriod } from "../../lib/chartBars";
import {
  candlesFromTicks,
  mapHashpriceCandles,
  rollupHashpriceCandles,
} from "../../lib/chartCandles";
import {
  byTimeMs,
  byUpdatedAt,
  currentBucketStartMs,
  spliceNewestBuckets,
} from "../../lib/chartOverlay";
import {
  hourAggToAverageTick,
  oracleTickToAverage,
  type HourAggRow,
  type HourOhlcRow,
} from "./fetchOracleHourAverages";
import { requestOracleAggregation } from "./oracleCurrentBucket";
import { oracleOverlaySlices } from "./queries/oracles";
import { buildDocument, type Slice } from "./queries/slice";
import { btcLineFromAverages, BTC_PRICE_INDEX_QK } from "./useBtcPriceIndexData";
import {
  hashpriceLineFromAverages,
  hashpriceTickToPrice,
  HASHPRICE_CHART_QK,
  type HashpriceChartData,
} from "./fetchHashpriceChart";
import {
  networkHashrateLineFromAverages,
  NETWORK_HASHRATE_INDEX_QK,
} from "./useNetworkHashrateIndexData";

export type OracleSeries = "hashprice" | "btc" | "networkHashrate";

/** Enough hourly rows to cover the widest bar, which is 12h on the 1M range. */
const BUCKET_FIRST = 24;

/** Upper bound on raw ticks inside one 15m bar; the oracle posts far fewer. */
const TICK_FIRST = 500;

type TickRow = { id: string | number; timestamp: string; price?: string; hashrateHpS?: string };

type OverlayResponse = Partial<{
  hashpriceUsds: TickRow[];
  btcUsds: TickRow[];
  networkHashrate7Ds: TickRow[];
  hashpriceUsdCandles: HourOhlcRow[];
  btcUsdCandles: HourAggRow[];
  networkHashrate7DCandles: HourAggRow[];
}>;

/** Which root field each series reads, for each of the two bar sources. */
const SLICE_FOR: Record<OracleSeries, { tick: Slice; hour: Slice }> = {
  hashprice: {
    tick: oracleOverlaySlices.hashpriceUsds,
    hour: oracleOverlaySlices.hashpriceUsdCandles,
  },
  btc: {
    tick: oracleOverlaySlices.btcUsds,
    hour: oracleOverlaySlices.btcUsdCandles,
  },
  networkHashrate: {
    tick: oracleOverlaySlices.networkHashrate7Ds,
    hour: oracleOverlaySlices.networkHashrate7DCandles,
  },
};

/**
 * Write `next` into a chart's cache entry, unless it is the array already there.
 *
 * `spliceNewestBuckets` returns the cached array unchanged when the bar has not
 * moved, which is the common case — the oracle posts far less often than this
 * polls — so the identity check here is what keeps the charts from re-rendering
 * on every tick.
 */
const writeSeries = <T extends { updatedAt: number }>(
  qc: QueryClient,
  key: unknown[],
  overlay: readonly T[],
  bucketStartMs: number,
): void => {
  const cached = qc.getQueryData<T[]>(key);
  // Nothing to splice onto: the range itself has not loaded yet, and it will
  // include this bar when it does.
  if (!cached) return;

  const next = spliceNewestBuckets(cached, overlay, bucketStartMs, byUpdatedAt);
  if (next !== cached) qc.setQueryData(key, next);
};

/**
 * Fetch the bar in progress for the given series and splice it into their
 * charts' cache entries.
 */
export const fetchOracleOverlay = async (
  qc: QueryClient,
  timePeriod: TimePeriod,
  series: readonly OracleSeries[],
): Promise<void> => {
  if (series.length === 0) return;

  const spec = chartRangeSpec(timePeriod);
  const bucketStartMs = currentBucketStartMs(spec.intervalMs);
  const slices = series.map((name) => SLICE_FOR[name][spec.source]);

  const response = await requestOracleAggregation<OverlayResponse>(
    buildDocument("OracleOverlay", slices),
    {
      bucketStart: String(bucketStartMs * 1000),
      bucketFirst: spec.source === "tick" ? TICK_FIRST : BUCKET_FIRST,
    },
  );

  if (series.includes("hashprice")) {
    const rows = response.hashpriceUsds ?? [];
    const candleRows = response.hashpriceUsdCandles ?? [];

    const averages =
      spec.source === "tick"
        ? rows.map((row) => oracleTickToAverage(row, row.price))
        : candleRows.map(hourAggToAverageTick);
    const line = hashpriceLineFromAverages(averages, spec.intervalMs);

    const candles =
      spec.source === "tick"
        ? candlesFromTicks(
            rows.map((row) => hashpriceTickToPrice({ ...row, price: row.price ?? "0" })),
            spec.intervalMs,
          )
        : rollupHashpriceCandles(mapHashpriceCandles(candleRows), spec.intervalMs);

    // This entry holds the line and the candles together, so both are spliced
    // and it is written once if either moved.
    const key = [HASHPRICE_CHART_QK, timePeriod];
    const cached = qc.getQueryData<HashpriceChartData>(key);
    if (cached) {
      const nextLine = spliceNewestBuckets(cached.line, line, bucketStartMs, byUpdatedAt);
      const nextCandles = spliceNewestBuckets(cached.candles, candles, bucketStartMs, byTimeMs);

      if (nextLine !== cached.line || nextCandles !== cached.candles) {
        qc.setQueryData(key, {
          line: nextLine as HashpriceChartData["line"],
          candles: nextCandles as HashpriceChartData["candles"],
        });
      }
    }
  }

  if (series.includes("btc")) {
    const averages =
      spec.source === "tick"
        ? (response.btcUsds ?? []).map((row) => oracleTickToAverage(row, row.price))
        : (response.btcUsdCandles ?? []).map(hourAggToAverageTick);

    writeSeries(
      qc,
      [BTC_PRICE_INDEX_QK, timePeriod],
      btcLineFromAverages(averages, spec.intervalMs),
      bucketStartMs,
    );
  }

  if (series.includes("networkHashrate")) {
    const averages =
      spec.source === "tick"
        ? (response.networkHashrate7Ds ?? []).map((row) => oracleTickToAverage(row, row.hashrateHpS))
        : (response.networkHashrate7DCandles ?? []).map(hourAggToAverageTick);

    writeSeries(
      qc,
      [NETWORK_HASHRATE_INDEX_QK, timePeriod],
      networkHashrateLineFromAverages(averages, spec.intervalMs),
      bucketStartMs,
    );
  }
};
