import { graphqlRequest } from "./graphql";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { backgroundRefetchOpts } from "./config";
import { BtcPriceIndexQuery, AggregatedBtcPriceIndexQuery } from "./graphql-queries";
import type { TimePeriod } from "./useHashRateIndexData";
import { prefetchSeed, withSeedFallback } from "./seed-utils";

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

export const BTC_PRICE_INDEX_QK = "btcPriceIndex";

export const useBtcPriceIndexData = (props?: { refetch?: boolean; timePeriod?: TimePeriod }) => {
  const timePeriod = props?.timePeriod ?? "day";

  const query = useQuery({
    queryKey: [BTC_PRICE_INDEX_QK, timePeriod],
    queryFn: () => fetchBtcPriceIndexData(timePeriod),
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
  const startMicros = BigInt(startDate) * 1_000_000n;

  // Kick off seed load in parallel with subgraph pagination
  const seedPromise = prefetchSeed("btcUsds", loadBtcUsdsSeed);

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

  allIndexes = await withSeedFallback(allIndexes, seedPromise, startMicros);
  allIndexes = allIndexes.filter((item) => BigInt(item.timestamp) >= startMicros);
  allIndexes.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  return allIndexes.map((item) => {
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
}

async function fetchAggregatedBtcPriceIndex(timePeriod: "week" | "month") {
  const interval = timePeriod === "week" ? "hour" : "day";

  const now = Math.floor(Date.now() / 1000);
  const daysInSeconds = timePeriod === "week" ? 7 * 24 * 60 * 60 : 31 * 24 * 60 * 60;
  const startTimestamp = Math.floor((now - daysInSeconds) * 1000 * 1000).toString();

  // Kick off seed load in parallel with subgraph pagination
  const candleSeedKey = interval === "hour" ? "btcUsdCandlesHour" as const : "btcUsdCandlesDay" as const;
  const seedPromise = prefetchSeed(
    candleSeedKey,
    interval === "hour" ? loadBtcUsdCandlesHourSeed : loadBtcUsdCandlesDaySeed,
  );

  // Fetch all data using cursor-based pagination
  let allCandles: AggregatedBtcPriceIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<AggregatedBtcPriceIndexRes>(
      AggregatedBtcPriceIndexQuery,
      { interval, first: PAGE_SIZE, skip, startTimestamp },
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
  allCandles = await withSeedFallback(allCandles, seedPromise, startMicros);
  allCandles.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  return allCandles.map((item) => {
    const count = Number(item.count);
    const sum = Number(item.sum);

    if (count === 0 || sum === 0) {
      return { updatedAt: item.timestamp, price: 0, id: item.id };
    }

    const avgPrice = sum / count;
    return {
      updatedAt: item.timestamp,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      price: avgPrice / PRICE_SCALE,
    };
  });
}
