import { useReadContract } from "wagmi";
import { FuturesAbi } from "futures-marketplace-abi/Futures.ts";
import { withErrors } from "../../lib/withErrors";

/// Reads the `portfolioMargin` address from the Futures contract.
/// This is the IPortfolioMarginEngine contract used for margin calculations
/// and risk management.
export function useFuturesMarginEngine() {
  const futures = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`;
  const result = useReadContract({
    address: futures,
    abi: withErrors(FuturesAbi),
    functionName: "portfolioMargin",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });

  return result;
}
