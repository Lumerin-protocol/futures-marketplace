import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TimePeriod } from "../../lib/chartBars";
import { fetchOracleOverlay, type OracleSeries } from "./oracleOverlay";
import { SNAPSHOT_TICK_MS } from "./snapshot/config";
import { subgraphRetryOptions } from "./subgraphRetry";

export const ORACLE_OVERLAY_QK = "oracleOverlay";

/**
 * Polls the bar in progress for the index series currently on the chart.
 *
 * Mount once, alongside the chart. It writes into the three chart cache entries
 * directly, the way the venue drivers do, so the index hooks need to know
 * nothing about it.
 *
 * `series` is what the chart legend has switched on: hashprice is always there,
 * the other two only when the user ticks them. A series that is off is not in
 * the request at all, which is the whole reason the document is assembled per
 * tick rather than written out once.
 */
export const useOracleOverlay = (timePeriod: TimePeriod, series: readonly OracleSeries[]) => {
  const qc = useQueryClient();

  // Sorted so that toggling two series on in either order shares one entry.
  const active = [...series].sort();

  return useQuery({
    queryKey: [ORACLE_OVERLAY_QK, timePeriod, active],
    queryFn: async () => {
      await fetchOracleOverlay(qc, timePeriod, active);
      // The result is the cache writes; this only records that a tick ran.
      return Date.now();
    },
    enabled: active.length > 0,
    refetchInterval: SNAPSHOT_TICK_MS,
    refetchIntervalInBackground: false,
    // Nothing renders this entry — it exists to drive the fetch — so there is
    // no reason to re-render its subscriber when it settles.
    notifyOnChangeProps: [],
    ...subgraphRetryOptions,
  });
};
