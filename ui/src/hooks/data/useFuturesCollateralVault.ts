import { useReadContract } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";
import { withErrors } from "../../lib/withErrors";

/// Reads the immutable `collateralVault` address from the Futures contract.
/// USDC must be approved to this address (not the Futures contract) before
/// calling `addMargin` / `collateralVault.deposit` / `collateralVault.depositFor`.
export function useFuturesCollateralVault() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(FuturesAbi),
    functionName: "collateralVault",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
}
