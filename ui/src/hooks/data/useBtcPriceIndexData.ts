import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { backgroundRefetchOpts, indexGcTimeMs } from "./config";
import { subgraphRetryOptions } from "./subgraphRetry";
import { BtcPriceIndexQuery } from "./queries/oracles";
import type { TimePeriod } from "./useHashRateIndexData";
import { prefetchSeed, withSeedFallback } from "./seed-utils";
import { paginateOracleTicks } from "./paginateOracleTicks";
import {
  fetchOracleHourAggRows,
  hourAggToAverageTick,
  oracleTickToAverage,
} from "./fetchOracleHourAverages";
import { chartRangeSpec, rollupAverageTicks, startMicrosForRange, type AverageTick } from "../../lib/chartBars";

const loadBtcUsdsSeed = () =>
  import(/* webpackChunkName: "seed-btc-usds" */ "../../seed/btcUsds.json").then((m) => m.default);
const loadBtcUsdCandlesHourSeed = () =>
  import(/* webpackChunkName: "seed-btc-usd-candles-hour" */ "../../seed/btcUsdCandles-hour.json").then(
    (m) => m.default,
  );

const PRICE_SCALE = 10 ** 8;

type BtcPriceIndexItem = {
  blockNumber?: string;
  price: string;
  timestamp: string;
  id: string | number;
};

export const BTC_PRICE_INDEX_QK = "btcPriceIndex";

export const useBtcPriceIndexData = (props?: { refetch?: boolean; timePeriod?: TimePeriod }) => {
  const timePeriod = props?.timePeriod ?? "5d";

  return useQuery({
    queryKey: [BTC_PRICE_INDEX_QK, timePeriod],
    queryFn: () => fetchBtcPriceIndexData(timePeriod),
    placeholderData: keepPreviousData,
    staleTime: chartRangeSpec(timePeriod).intervalMs,
    gcTime: indexGcTimeMs,
    ...subgraphRetryOptions,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });
};

async function fetchBtcPriceIndexData(timePeriod: TimePeriod) {
  const spec = chartRangeSpec(timePeriod);
  const startMicros = startMicrosForRange(timePeriod);

  let ticks: AverageTick[];
  if (spec.source === "tick") {
    const seedPromise = prefetchSeed("btcUsds", loadBtcUsdsSeed);
    let allIndexes = await paginateOracleTicks<BtcPriceIndexItem>(BtcPriceIndexQuery, "btcUsds", startMicros);
    allIndexes = await withSeedFallback(allIndexes, seedPromise, BigInt(startMicros));
    allIndexes = allIndexes.filter((item) => BigInt(item.timestamp) >= BigInt(startMicros));
    ticks = allIndexes.map((item) => oracleTickToAverage(item, item.price));
  } else {
    const seedPromise = prefetchSeed("btcUsdCandlesHour", loadBtcUsdCandlesHourSeed);
    let rows = await fetchOracleHourAggRows("btcUsdCandles", startMicros);
    rows = await withSeedFallback(rows, seedPromise, BigInt(startMicros));
    ticks = rows.map(hourAggToAverageTick);
  }

  return btcLineFromAverages(ticks, spec.intervalMs);
}

/** See `hashpriceLineFromAverages`; the overlay builds its bar with this. */
export const btcLineFromAverages = (rows: AverageTick[], intervalMs: number) =>
  rollupAverageTicks(rows, intervalMs).map((bucket) => ({
    updatedAt: bucket.timeMs,
    updatedAtDate: new Date(bucket.timeMs),
    id: bucket.id,
    price: bucket.sum / bucket.count / PRICE_SCALE,
  }));
