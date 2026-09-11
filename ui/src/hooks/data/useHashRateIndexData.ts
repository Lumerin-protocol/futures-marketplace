import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { backgroundRefetchOpts, indexGcTimeMs } from "./config";
import { fetchHashpriceChart, HASHPRICE_CHART_QK } from "./fetchHashpriceChart";
import { chartRangeSpec, type TimePeriod } from "../../lib/chartBars";

export type { TimePeriod };
export type { HashrateIndexPoint } from "./fetchHashpriceChart";

/** Shared with candles so line and OHLC share one Goldsky request. */
export const HASHRATE_INDEX_QK = HASHPRICE_CHART_QK;

export const useHashrateIndexData = (props?: { refetch?: boolean; timePeriod?: TimePeriod }) => {
  const timePeriod = props?.timePeriod ?? "5d";

  return useQuery({
    queryKey: [HASHRATE_INDEX_QK, timePeriod],
    queryFn: () => fetchHashpriceChart(timePeriod),
    select: (data) => data.line,
    placeholderData: keepPreviousData,
    staleTime: chartRangeSpec(timePeriod).intervalMs,
    gcTime: indexGcTimeMs,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });
};
