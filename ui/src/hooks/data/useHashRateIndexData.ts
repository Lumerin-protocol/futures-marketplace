import { graphqlRequest } from "./graphql";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { backgroundRefetchOpts, indexGcTimeMs, indexStaleTimeMs } from "./config";
import { HashrateIndexQuery, AggregatedHashrateIndexQuery } from "./graphql-queries";
import { prefetchSeed, withSeedFallback } from "./seed-utils";

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
const PRICE_SCALE = 10 ** 8;

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

export const HASHRATE_INDEX_QK = "hashrateIndex";

export const useHashrateIndexData = (props?: { refetch?: boolean; timePeriod?: TimePeriod }) => {
  const timePeriod = props?.timePeriod ?? "day";

  const query = useQuery({
    queryKey: [HASHRATE_INDEX_QK, timePeriod],
    queryFn: () => fetchHashrateIndexData(timePeriod),
    placeholderData: keepPreviousData,
    staleTime: indexStaleTimeMs[timePeriod],
    gcTime: indexGcTimeMs,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

async function fetchHashrateIndexData(timePeriod: TimePeriod) {
  if (timePeriod === "week" || timePeriod === "month") {
    return fetchAggregatedHashrateIndex(timePeriod);
  }
  return fetchDayHashrateIndex();
}

async function fetchDayHashrateIndex() {
  const now = Math.floor(Date.now() / 1000);
  const startDate = now - 24 * 60 * 60; // 1 day
  const startMicros = BigInt(startDate) * 1_000_000n;

  // Kick off seed load in parallel with subgraph pagination
  const seedPromise = prefetchSeed("hashpriceUsds", loadHashpriceUsdsSeed);

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

  allIndexes = await withSeedFallback(allIndexes, seedPromise, startMicros);
  allIndexes = allIndexes.filter((item) => BigInt(item.timestamp) >= startMicros);
  allIndexes.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  return allIndexes.map((item) => {
    if (item.price === "0") {
      return { updatedAt: item.timestamp, priceToken: 0, id: item.id };
    }
    return {
      updatedAt: +item.timestamp / 1000,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      priceToken: Number(item.price) / PRICE_SCALE,
    };
  });
}

async function fetchAggregatedHashrateIndex(timePeriod: "week" | "month") {
  const interval = timePeriod === "week" ? "hour" : "day";

  const now = Math.floor(Date.now() / 1000);
  const daysInSeconds = timePeriod === "week" ? 7 * 24 * 60 * 60 : 31 * 24 * 60 * 60;
  const startTimestamp = Math.floor((now - daysInSeconds) * 1000 * 1000).toString();

  // Kick off seed load in parallel with subgraph pagination
  const candleSeedKey = interval === "hour" ? "hashpriceUsdCandlesHour" as const : "hashpriceUsdCandlesDay" as const;
  const seedPromise = prefetchSeed(
    candleSeedKey,
    interval === "hour" ? loadHashpriceUsdCandlesHourSeed : loadHashpriceUsdCandlesDaySeed,
  );

  // Fetch all data using cursor-based pagination
  let allCandles: AggregatedHashrateIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<AggregatedHashrateIndexRes>(
      AggregatedHashrateIndexQuery,
      { interval, first: PAGE_SIZE, skip, startTimestamp },
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
  allCandles = await withSeedFallback(allCandles, seedPromise, startMicros);
  allCandles.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  return allCandles.map((item) => {
    const count = Number(item.count);
    const sum = Number(item.sum);

    if (count === 0 || sum === 0) {
      return { updatedAt: item.timestamp, priceToken: 0, id: item.id };
    }

    const avgPrice = sum / count;
    return {
      updatedAt: item.timestamp,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      priceToken: avgPrice / PRICE_SCALE,
    };
  });
}
