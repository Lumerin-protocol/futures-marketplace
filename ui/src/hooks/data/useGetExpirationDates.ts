import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { backgroundRefetchOpts } from "./config";
import { withErrors } from "../../lib/withErrors";

export function useGetExpirationDates() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(HashPowerFuturesAbi),
    functionName: "getExpirationDates",
    query: {
      ...backgroundRefetchOpts,
    },
  });
}

/**
 * The futures expirations a user can actually trade right now, as unix seconds
 * ascending — one entry per instrument in the market selector.
 *
 * The contract returns a rolling forward window, but the expiry at the front of
 * it matures before the next read lands, so the past is dropped here too. That
 * cutoff is recomputed on the background refetch rather than on a timer, which
 * is the same freshness the order book had when it owned this list.
 */
export function useTradableExpirations() {
  const { data, isLoading, isError } = useGetExpirationDates();

  const expirations = useMemo(() => {
    if (!data) return [];
    const now = Math.floor(Date.now() / 1000);
    return data
      .map(Number)
      .filter((expirationAt) => expirationAt >= now)
      .sort((a, b) => a - b);
  }, [data]);

  return { expirations, isLoading, isError };
}
