import { useEffect, useRef, useState } from "react";
import { useReadContract } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";
import { withErrors } from "../../lib/withErrors";

/**
 * Hook to get current market price from Futures contract
 * Polls every 10 seconds to keep the price up to date
 */
export function useGetMarketPrice() {
  const result = useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS,
    // Merge the custom error ABI so viem can decode reverts (e.g. OracleStale,
    // InvalidPrice) into named errors instead of opaque hex data.
    abi: withErrors(FuturesAbi),
    functionName: "getMarketPrice",
    query: {
      refetchInterval: 10000, // Poll every 10 seconds
      refetchOnMount: true,
      refetchOnWindowFocus: true,
    },
  });

  // Remember the last distinct polled price so callers can diff the current
  // value against it (the contract read only exposes the latest value).
  const lastRef = useRef<bigint | undefined>(undefined);
  const [previousData, setPreviousData] = useState<bigint | undefined>(undefined);

  useEffect(() => {
    const current = result.data as bigint | undefined;
    if (current == null || current === lastRef.current) return;
    if (lastRef.current != null) {
      setPreviousData(lastRef.current);
    }
    lastRef.current = current;
  }, [result.data]);

  // NOTE: read failures (revert/decoding/RPC) are logged centrally by the
  // QueryCache.onError handler in Web3Provider, so no per-hook error effect here.

  // Warn when the on-chain read has settled but returned no usable price.
  // A 0 or undefined value keeps the Place Order widget stuck on the
  // "Loading contract specifications..." spinner, so surface it explicitly.
  useEffect(() => {
    if (result.isLoading) return; // ignore the initial in-flight fetch
    const current = result.data as bigint | undefined;
    if (current === undefined || current === 0n) {
      console.warn(
        `[useGetMarketPrice] getMarketPrice() returned ${
          current === undefined ? "undefined" : "0"
        }.  `
      );
    }
  }, [result.data, result.isLoading]);

  return {
    ...result,
    previousData,
    dataFetchedAt: result.dataUpdatedAt ? new Date(result.dataUpdatedAt) : undefined,
  };
}
