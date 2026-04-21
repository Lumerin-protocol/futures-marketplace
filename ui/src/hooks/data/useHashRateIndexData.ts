import { graphqlRequest } from "./graphql";
import { useQuery } from "@tanstack/react-query";
import { backgroundRefetchOpts } from "./config";
import { HashrateIndexQuery, AggregatedHashrateIndexQuery } from "./graphql-queries";

export type TimePeriod = "day" | "week" | "month";

const PAGE_SIZE = 250;

type HashrateIndexItem = {
  blockNumber: string;
  price: string;
  timestamp: string;
  id: number;
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
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const PRICE_SCALE = 10 ** 8;

async function fetchHashrateIndexData(timePeriod: TimePeriod) {
  if (timePeriod === "week" || timePeriod === "month") {
    return fetchAggregatedHashrateIndex(timePeriod);
  }
  return fetchDayHashrateIndex();
}

async function fetchDayHashrateIndex() {
  const now = Math.floor(Date.now() / 1000);
  const startDate = now - 24 * 60 * 60; // 1 day

  // Fetch all data using cursor-based pagination
  let allIndexes: HashrateIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<HashrateIndexRes>(
      HashrateIndexQuery,
      {
        startDate,
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
      priceToken: Number(item.price) / PRICE_SCALE,
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
      priceToken: avgPrice / PRICE_SCALE,
    };
  });
  return data;
}
