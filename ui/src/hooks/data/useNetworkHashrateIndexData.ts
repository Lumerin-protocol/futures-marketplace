import { graphqlRequest } from "./graphql";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { backgroundRefetchOpts, indexGcTimeMs, indexStaleTimeMs } from "./config";
import { NetworkHashrateIndexQuery, AggregatedNetworkHashrateIndexQuery } from "./graphql-queries";
import type { TimePeriod } from "./useHashRateIndexData";

const PAGE_SIZE = 250;

/** The subgraph stores hashes per second; the chart reads exahashes per second. */
const EXAHASH = 10 ** 18;

type NetworkHashrateIndexItem = {
  blockNumber?: string;
  hashrateHpS: string;
  timestamp: string;
  id: string | number;
};

// graph-node derives the collection name from the entity, capitalising the `d`
// of `7d` as a word of its own: `NetworkHashrate7d` is queried as
// `networkHashrate7Ds`, not `networkHashrate7ds`.
type NetworkHashrateIndexRes = {
  networkHashrate7Ds: NetworkHashrateIndexItem[];
};

type AggregatedNetworkHashrateIndexItem = {
  count: string;
  id: string;
  sum: string;
  timestamp: string;
};

type AggregatedNetworkHashrateIndexRes = {
  networkHashrate7DCandles: AggregatedNetworkHashrateIndexItem[];
};

export const NETWORK_HASHRATE_INDEX_QK = "networkHashrateIndex";

export const useNetworkHashrateIndexData = (props?: { refetch?: boolean; timePeriod?: TimePeriod }) => {
  const timePeriod = props?.timePeriod ?? "day";

  const query = useQuery({
    queryKey: [NETWORK_HASHRATE_INDEX_QK, timePeriod],
    queryFn: () => fetchNetworkHashrateIndexData(timePeriod),
    placeholderData: keepPreviousData,
    staleTime: indexStaleTimeMs[timePeriod],
    gcTime: indexGcTimeMs,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

async function fetchNetworkHashrateIndexData(timePeriod: TimePeriod) {
  if (timePeriod === "week" || timePeriod === "month") {
    return fetchAggregatedNetworkHashrateIndex(timePeriod);
  }
  return fetchDayNetworkHashrateIndex();
}

// Unlike the price feeds there is no bundled seed for this series: it was
// indexed from the oracle's start block, so the subgraph already reaches back
// past the widest chart range on its own. The one gap is the oracle's first
// ~1008 Bitcoin blocks, which predate a full 7-day window and so carry no rows.
async function fetchDayNetworkHashrateIndex() {
  const now = Math.floor(Date.now() / 1000);
  const startDate = now - 24 * 60 * 60; // 1 day
  const startMicros = BigInt(startDate) * 1_000_000n;

  // Fetch all data using cursor-based pagination
  let allIndexes: NetworkHashrateIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<NetworkHashrateIndexRes>(
      NetworkHashrateIndexQuery,
      {
        startDate: startMicros.toString(),
        first: PAGE_SIZE,
        skip,
      },
      process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
    );

    allIndexes = [...allIndexes, ...req.networkHashrate7Ds];

    if (req.networkHashrate7Ds.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  allIndexes.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  return allIndexes.map((item) => ({
    updatedAt: +item.timestamp / 1000,
    updatedAtDate: new Date(+item.timestamp / 1000),
    id: item.id,
    hashrateEhS: Number(item.hashrateHpS) / EXAHASH,
  }));
}

async function fetchAggregatedNetworkHashrateIndex(timePeriod: "week" | "month") {
  const interval = timePeriod === "week" ? "hour" : "day";

  const now = Math.floor(Date.now() / 1000);
  const daysInSeconds = timePeriod === "week" ? 7 * 24 * 60 * 60 : 31 * 24 * 60 * 60;
  const startTimestamp = Math.floor((now - daysInSeconds) * 1000 * 1000).toString();

  // Fetch all data using cursor-based pagination
  let allCandles: AggregatedNetworkHashrateIndexItem[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const req = await graphqlRequest<AggregatedNetworkHashrateIndexRes>(
      AggregatedNetworkHashrateIndexQuery,
      { interval, first: PAGE_SIZE, skip, startTimestamp },
      process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
    );

    allCandles = [...allCandles, ...req.networkHashrate7DCandles];

    if (req.networkHashrate7DCandles.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  allCandles.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));

  return allCandles.map((item) => {
    const count = Number(item.count);
    const sum = Number(item.sum);

    if (count === 0 || sum === 0) {
      return {
        updatedAt: +item.timestamp / 1000,
        updatedAtDate: new Date(+item.timestamp / 1000),
        id: item.id,
        hashrateEhS: 0,
      };
    }

    // Every row in the bucket is already a 7-day average, so this only decimates
    // the series down to one point per interval rather than smoothing it further.
    return {
      updatedAt: +item.timestamp / 1000,
      updatedAtDate: new Date(+item.timestamp / 1000),
      id: item.id,
      hashrateEhS: sum / count / EXAHASH,
    };
  });
}
