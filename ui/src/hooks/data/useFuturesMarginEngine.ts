import { useReadContract } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";
import { withErrors } from "../../lib/withErrors";

/// Reads the immutable `marginEngine` address from the Futures contract.
/// This is the IPortfolioMarginEngine contract used for margin calculations
/// and risk management.
export function useFuturesMarginEngine() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(FuturesAbi),
    functionName: "marginEngine",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
}
