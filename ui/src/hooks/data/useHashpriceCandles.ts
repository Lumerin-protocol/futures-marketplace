import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { backgroundRefetchOpts, indexGcTimeMs } from "./config";
import { fetchHashpriceChart, HASHPRICE_CHART_QK } from "./fetchHashpriceChart";
import type { TimePeriod } from "./useHashRateIndexData";
import { chartRangeSpec } from "../../lib/chartBars";
import type { HashpriceCandle } from "../../lib/chartCandles";

const DEFAULT_RETRY_COUNT = 3;

export const HASHPRICE_CANDLES_QK = HASHPRICE_CHART_QK;

export class EmptyCandleDataError extends Error {
  readonly name = "EmptyCandleDataError";

  constructor(timePeriod: TimePeriod) {
    super(`No hashprice candles for ${timePeriod}`);
  }
}

export const isEmptyCandleDataError = (error: unknown): boolean =>
  error instanceof EmptyCandleDataError || (error instanceof Error && error.name === "EmptyCandleDataError");

export const requireCandles = (candles: HashpriceCandle[], timePeriod: TimePeriod): HashpriceCandle[] => {
  if (candles.length === 0) throw new EmptyCandleDataError(timePeriod);
  return candles;
};

/**
 * Same Goldsky fetch as the line series. 1D is 15m from ticks; 5D is hourly
 * aggregations; 1M rolls those hours to 12h.
 */
export const useHashpriceCandles = (props?: { refetch?: boolean; timePeriod?: TimePeriod; enabled?: boolean }) => {
  const timePeriod = props?.timePeriod ?? "5d";

  return useQuery({
    queryKey: [HASHPRICE_CANDLES_QK, timePeriod],
    queryFn: () => fetchHashpriceChart(timePeriod),
    select: (data) => data.candles,
    placeholderData: keepPreviousData,
    staleTime: chartRangeSpec(timePeriod).intervalMs,
    gcTime: indexGcTimeMs,
    enabled: props?.enabled ?? true,
    retry: (failureCount, error) => !isEmptyCandleDataError(error) && failureCount < DEFAULT_RETRY_COUNT,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });
};
