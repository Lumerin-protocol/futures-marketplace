import { graphqlRequest } from "./graphql";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { backgroundRefetchOpts } from "./config";
import { BtcPriceIndexQuery, AggregatedBtcPriceIndexQuery } from "./graphql-queries";
import type { TimePeriod } from "./useHashRateIndexData";

const loadBtcUsdsSeed = () =>
  import(/* webpackChunkName: "seed-btc-usds" */ "../../seed/btcUsds.json").then((m) => m.default);
const loadBtcUsdCandlesHourSeed = () =>
  import(/* webpackChunkName: "seed-btc-usd-candles-hour" */ "../../seed/btcUsdCandles-hour.json").then((m) => m.default);
const loadBtcUsdCandlesDaySeed = () =>
  import(/* webpackChunkName: "seed-btc-usd-candles-day" */ "../../seed/btcUsdCandles-day.json").then((m) => m.default);

const PAGE_SIZE = 250;
const PRICE_SCALE = 10 ** 8;

type BtcPriceIndexItem = {
  blockNumber?: string;
  price: string;
  timestamp: string;
  id: string | number;
};

type BtcPriceIndexRes = {
  btcUsds: BtcPriceIndexItem[];
};

type AggregatedBtcPriceIndexItem = {
  count: string;
  id: string;
  sum: string;
  timestamp: string;
};

type AggregatedBtcPriceIndexRes = {
  btcUsdCandles: AggregatedBtcPriceIndexItem[];
};

function mergeById<T extends { id: string | number }>(primary: T[], seed: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of [...primary, ...seed]) {
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export const BTC_PRICE_INDEX_QK = "btcPriceIndex";

export const useBtcPriceIndexData = (props?: { refetch?: boolean; timePeriod?: TimePeriod }) => {
  const timePeriod = props?.timePeriod ?? "day";

  const query = useQuery({
    queryKey: [BTC_PRICE_INDEX_QK, timePeriod],
    queryFn: () => fetchBtcPriceIndexData(timePeriod),
    // Keep showing the previous period's data while the new period loads
    // to avoid a brief empty/"no data" flash when switching time periods.
    placeholderData: keepPreviousData,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

async function fetchBtcPriceIndexData(timePeriod: TimePeriod) {
  if (timePeriod === "week" || timePeriod === "month") {
    return fetchAggregatedBtcPriceIndex(timePeriod);
  }
  return fetchDayBtcPriceIndex();
}

async function fetchDayBtcPriceIndex() {
  const now = Math.floor(Date.now() / 1000);
  const startDate = now - 24 * 60 * 60; // 1 day
  // Subgraph/seed timestamps are stored in microseconds
  const startMicros = BigInt(startDate) * 1_000_000n;

  // Fetch all data using cursor-based pagination
  let allIndexes: BtcPriceIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<BtcPriceIndexRes>(
      BtcPriceIndexQuery,
      {
        startDate: startMicros.toString(),
        first: PAGE_SIZE,
        skip,
      },
      process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
    );

    allIndexes = [...allIndexes, ...req.btcUsds];

    if (req.btcUsds.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  if (process.env.REACT_APP_USE_SEED_DATA === "true") {
    const seed = (await loadBtcUsdsSeed()) as BtcPriceIndexItem[];
    const seedForRange = seed.filter((item) => BigInt(item.timestamp) >= startMicros);
    allIndexes = mergeById(allIndexes, seedForRange).filter(
      (item) => BigInt(item.timestamp) >= startMicros,
    );
  }
  allIndexes = allIndexes.filter((item) => BigInt(item.timestamp) >= startMicros);
  allIndexes.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  const data = allIndexes.map((item) => {
    if (item.price === "0" || !item.price) {
      return {
        updatedAt: +item.timestamp / 1000,
        updatedAtDate: new Date(+item.timestamp / 1000),
        price: 0,
        id: item.id,
      };
    }

    return {
      updatedAt: +item.timestamp / 1000,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      price: Number(item.price) / PRICE_SCALE,
    };
  });
  return data;
}

async function fetchAggregatedBtcPriceIndex(timePeriod: "week" | "month") {
  // week uses hour interval, month uses day interval
  const interval = timePeriod === "week" ? "hour" : "day";

  // Calculate start timestamp: 7 days for week, 31 days for month
  const now = Math.floor(Date.now() / 1000);
  const daysInSeconds = timePeriod === "week" ? 7 * 24 * 60 * 60 : 31 * 24 * 60 * 60;
  // Multiply by 1000 * 1000 since timestamp in candles is in Microseconds
  // Use Math.floor to ensure integer value for BigInt
  const startTimestamp = Math.floor((now - daysInSeconds) * 1000 * 1000).toString();

  // Fetch all data using cursor-based pagination
  let allCandles: AggregatedBtcPriceIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<AggregatedBtcPriceIndexRes>(
      AggregatedBtcPriceIndexQuery,
      {
        interval,
        first: PAGE_SIZE,
        skip,
        startTimestamp,
      },
      process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
    );

    allCandles = [...allCandles, ...req.btcUsdCandles];

    if (req.btcUsdCandles.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  const startMicros = BigInt(startTimestamp);
  if (process.env.REACT_APP_USE_SEED_DATA === "true") {
    const seed = (await (interval === "hour"
      ? loadBtcUsdCandlesHourSeed()
      : loadBtcUsdCandlesDaySeed())) as AggregatedBtcPriceIndexItem[];
    const seedForRange = seed.filter((item) => BigInt(item.timestamp) >= startMicros);
    allCandles = mergeById(allCandles, seedForRange);
  }
  allCandles.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  const data = allCandles.map((item) => {
    const count = Number(item.count);
    const sum = Number(item.sum);

    if (count === 0 || sum === 0) {
      return {
        updatedAt: item.timestamp,
        price: 0,
        id: item.id,
      };
    }

    const avgPrice = sum / count;

    return {
      updatedAt: item.timestamp,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      price: avgPrice / PRICE_SCALE,
    };
  });
  return data;
}
