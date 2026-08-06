import { useReadContract } from "wagmi";
import { FuturesAbi } from "futures-marketplace-abi/Futures.ts";
import { withErrors } from "../../lib/withErrors";

/// Reads the immutable `vault` address from the Futures contract.
/// USDC must be approved to this address (not the Futures contract) before
/// calling `addMargin` / `vault.deposit` / `vault.depositFor`.
export function useFuturesCollateralVault() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(FuturesAbi),
    functionName: "vault",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
}
