import { graphqlRequest } from "./graphql";
import { useQuery } from "@tanstack/react-query";
import { backgroundRefetchOpts } from "./config";
import { HashrateIndexQuery, AggregatedHashrateIndexQuery } from "./graphql-queries";

export type TimePeriod = "day" | "week" | "month";

const PAGE_SIZE = 250;

type HashrateIndexItem = {
  hashesForBTC: string;
  hashesForToken: string;
  updatedAt: string;
  id: number;
};

type HashrateIndexRes = {
  hashrateIndexes: HashrateIndexItem[];
};

type AggregatedHashrateIndexItem = {
  count: string;
  id: string;
  sum: string;
  timestamp: string;
};

type AggregatedHashrateIndexRes = {
  hashesForTokenCandles: AggregatedHashrateIndexItem[];
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

// for our contract on marketplace: 100 TH/s for 24 hours
const contractHPS = 100n * 10n ** 12n;
const contractDuration = 24n * 3600n;

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
    const req = await graphqlRequest<HashrateIndexRes>(HashrateIndexQuery, {
      startDate,
      first: PAGE_SIZE,
      skip,
    });

    allIndexes = [...allIndexes, ...req.hashrateIndexes];

    if (req.hashrateIndexes.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  const data = allIndexes.map((item) => {
    if (item.hashesForToken === "0") {
      return {
        updatedAt: item.updatedAt,
        priceToken: 0n,
        priceBTC: 0n,
        id: item.id,
      };
    }

    return {
      updatedAt: item.updatedAt,
      updatedAtDate: new Date(+item.updatedAt * 1000),
      id: item.id,
      ...hashrateIndexToCurrency(contractHPS, contractDuration, BigInt(item.hashesForBTC), BigInt(item.hashesForToken)),
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
    const req = await graphqlRequest<AggregatedHashrateIndexRes>(AggregatedHashrateIndexQuery, {
      interval,
      first: PAGE_SIZE,
      skip,
      startTimestamp,
    });

    allCandles = [...allCandles, ...req.hashesForTokenCandles];

    if (req.hashesForTokenCandles.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  const data = allCandles.map((item) => {
    const count = BigInt(item.count);
    const sum = BigInt(item.sum);

    if (count === 0n || sum === 0n) {
      return {
        updatedAt: item.timestamp,
        priceToken: 0n,
        id: item.id,
      };
    }

    // hashesForToken equivalent is sum / count
    const hashesForToken = sum / count;

    return {
      updatedAt: item.timestamp,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      ...hashrateIndexToCurrencyToken(contractHPS, contractDuration, hashesForToken),
    };
  });
  return data;
}

function hashrateIndexToCurrencyToken(contractHPS: bigint, contractDurationSeconds: bigint, hashesForToken: bigint) {
  const hashes = contractHPS * contractDurationSeconds;
  const priceToken = hashes / hashesForToken;
  return {
    priceToken,
  };
}

function hashrateIndexToCurrency(
  contractHPS: bigint,
  contractDurationSeconds: bigint,
  hashesForBTC: bigint,
  hashesForToken: bigint,
) {
  const hashes = contractHPS * contractDurationSeconds;
  const priceToken = hashes / hashesForToken;
  const priceBTC = hashes / hashesForBTC;
  return {
    priceToken,
    priceBTC,
  };
}
