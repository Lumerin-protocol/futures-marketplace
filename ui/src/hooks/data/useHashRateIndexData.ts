import { graphqlRequest } from "./graphql";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { backgroundRefetchOpts } from "./config";
import { HashrateIndexQuery, AggregatedHashrateIndexQuery } from "./graphql-queries";

const loadHashpriceUsdsSeed = () =>
  import(/* webpackChunkName: "seed-hashprice-usds" */ "../../seed/hashpriceUsds.json").then((m) => m.default);
const loadHashpriceUsdCandlesHourSeed = () =>
  import(/* webpackChunkName: "seed-hashprice-usd-candles-hour" */ "../../seed/hashpriceUsdCandles-hour.json").then(
    (m) => m.default,
  );
const loadHashpriceUsdCandlesDaySeed = () =>
  import(/* webpackChunkName: "seed-hashprice-usd-candles-day" */ "../../seed/hashpriceUsdCandles-day.json").then(
    (m) => m.default,
  );

export type TimePeriod = "day" | "week" | "month";

const PAGE_SIZE = 250;

type HashrateIndexItem = {
  blockNumber?: string;
  price: string;
  timestamp: string;
  id: string | number;
};

type HashrateIndexRes = {
  hashpriceUsds: HashrateIndexItem[];
};

type AggregatedHashrateIndexItem = {
  count: string;
  id: string;
  sum: string;
  timestamp: string;
};

type AggregatedHashrateIndexRes = {
  hashpriceUsdCandles: AggregatedHashrateIndexItem[];
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

export const HASHRATE_INDEX_QK = "hashrateIndex";

export const useHashrateIndexData = (props?: { refetch?: boolean; timePeriod?: TimePeriod }) => {
  const timePeriod = props?.timePeriod ?? "day";

  const query = useQuery({
    queryKey: [HASHRATE_INDEX_QK, timePeriod],
    queryFn: () => fetchHashrateIndexData(timePeriod),
    // Keep showing the previous period's data while the new period loads
    // to avoid a brief empty/"no data" flash when switching time periods.
    placeholderData: keepPreviousData,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const PRICE_SCALE = 10 ** 8;

// The oracle/indexer quotes hashprice per 100 TH/s per day, but a contract unit
// is 1 PH/s per day (10x). Scale chart values up so they match the contract basis.
const CONTRACT_SIZE_MULTIPLIER = 10;

async function fetchHashrateIndexData(timePeriod: TimePeriod) {
  if (timePeriod === "week" || timePeriod === "month") {
    return fetchAggregatedHashrateIndex(timePeriod);
  }
  return fetchDayHashrateIndex();
}

async function fetchDayHashrateIndex() {
  const now = Math.floor(Date.now() / 1000);
  const startDate = now - 24 * 60 * 60; // 1 day
  // Subgraph/seed timestamps are stored in microseconds
  const startMicros = BigInt(startDate) * 1_000_000n;

  // Fetch all data using cursor-based pagination
  let allIndexes: HashrateIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<HashrateIndexRes>(
      HashrateIndexQuery,
      {
        startDate: startMicros.toString(),
        first: PAGE_SIZE,
        skip,
      },
      process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
    );

    allIndexes = [...allIndexes, ...req.hashpriceUsds];

    if (req.hashpriceUsds.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  if (process.env.REACT_APP_USE_SEED_DATA === "true") {
    const seed = (await loadHashpriceUsdsSeed()) as HashrateIndexItem[];
    const seedForRange = seed.filter((item) => BigInt(item.timestamp) >= startMicros);
    allIndexes = mergeById(allIndexes, seedForRange).filter(
      (item) => BigInt(item.timestamp) >= startMicros,
    );
  }
  allIndexes = allIndexes.filter((item) => BigInt(item.timestamp) >= startMicros);
  allIndexes.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  const data = allIndexes.map((item) => {
    if (item.price === "0") {
      return {
        updatedAt: item.timestamp,
        priceToken: 0,
        id: item.id,
      };
    }

    return {
      updatedAt: +item.timestamp / 1000,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      priceToken: (Number(item.price) / PRICE_SCALE) * CONTRACT_SIZE_MULTIPLIER,
    };
  });
  return data;
}

async function fetchAggregatedHashrateIndex(timePeriod: "week" | "month") {
  // week uses hour interval, month uses day interval
  const interval = timePeriod === "week" ? "hour" : "day";

  // Calculate start timestamp: 7 days for week, 31 days for month
  const now = Math.floor(Date.now() / 1000);
  const daysInSeconds = timePeriod === "week" ? 7 * 24 * 60 * 60 : 31 * 24 * 60 * 60;
  // Multiply by 1000 * 1000 since timestamp in candles is in Microseconds
  // Use Math.floor to ensure integer value for BigInt
  const startTimestamp = Math.floor((now - daysInSeconds) * 1000 * 1000).toString();

  // Fetch all data using cursor-based pagination
  let allCandles: AggregatedHashrateIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<AggregatedHashrateIndexRes>(
      AggregatedHashrateIndexQuery,
      {
        interval,
        first: PAGE_SIZE,
        skip,
        startTimestamp,
      },
      process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
    );

    allCandles = [...allCandles, ...req.hashpriceUsdCandles];

    if (req.hashpriceUsdCandles.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  const startMicros = BigInt(startTimestamp);
  if (process.env.REACT_APP_USE_SEED_DATA === "true") {
    const seed = (await (interval === "hour"
      ? loadHashpriceUsdCandlesHourSeed()
      : loadHashpriceUsdCandlesDaySeed())) as AggregatedHashrateIndexItem[];
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
        priceToken: 0,
        id: item.id,
      };
    }

    const avgPrice = sum / count;

    return {
      updatedAt: item.timestamp,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      priceToken: (avgPrice / PRICE_SCALE) * CONTRACT_SIZE_MULTIPLIER,
    };
  });
  return data;
}
