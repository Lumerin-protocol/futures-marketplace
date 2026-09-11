import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { backgroundRefetchOpts, indexGcTimeMs } from "./config";
import { AggregatedNetworkHashrateIndexQuery, NetworkHashrateIndexQuery } from "./graphql-queries";
import type { TimePeriod } from "./useHashRateIndexData";
import { paginateOracleTicks } from "./paginateOracleTicks";
import { fetchOracleHourAggRows, hourAggToAverageTick } from "./fetchOracleHourAverages";
import { chartRangeSpec, rollupAverageTicks, startMicrosForRange, type AverageTick } from "../../lib/chartBars";
import { subgraphTimestampToMs } from "../../lib/chartCandles";

/** The subgraph stores hashes per second; the chart reads exahashes per second. */
const EXAHASH = 10 ** 18;

type NetworkHashrateIndexItem = {
  blockNumber?: string;
  hashrateHpS: string;
  timestamp: string;
  id: string | number;
};

export const NETWORK_HASHRATE_INDEX_QK = "networkHashrateIndex";

export const useNetworkHashrateIndexData = (props?: { refetch?: boolean; timePeriod?: TimePeriod }) => {
  const timePeriod = props?.timePeriod ?? "5d";

  return useQuery({
    queryKey: [NETWORK_HASHRATE_INDEX_QK, timePeriod],
    queryFn: () => fetchNetworkHashrateIndexData(timePeriod),
    placeholderData: keepPreviousData,
    staleTime: chartRangeSpec(timePeriod).intervalMs,
    gcTime: indexGcTimeMs,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });
};

async function fetchNetworkHashrateIndexData(timePeriod: TimePeriod) {
  const spec = chartRangeSpec(timePeriod);
  const startMicros = startMicrosForRange(timePeriod);

  let ticks: AverageTick[];
  if (spec.source === "tick") {
    const allIndexes = await paginateOracleTicks<NetworkHashrateIndexItem>(
      NetworkHashrateIndexQuery,
      "networkHashrate7Ds",
      startMicros,
    );
    ticks = allIndexes.map((item) => ({
      id: String(item.id),
      timeMs: subgraphTimestampToMs(item.timestamp),
      sum: Number(item.hashrateHpS),
      count: 1,
    }));
  } else {
    const rows = await fetchOracleHourAggRows(
      AggregatedNetworkHashrateIndexQuery,
      "networkHashrate7DCandles",
      startMicros,
    );
    ticks = rows.map(hourAggToAverageTick);
  }

  return rollupAverageTicks(ticks, spec.intervalMs).map((bucket) => ({
    updatedAt: bucket.timeMs,
    updatedAtDate: new Date(bucket.timeMs),
    id: bucket.id,
    hashrateEhS: bucket.sum / bucket.count / EXAHASH,
  }));
}
