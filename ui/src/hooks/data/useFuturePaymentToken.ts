import { useReadContract } from "wagmi";
import { CollateralVaultAbi } from "../../abi/ICollateralVault";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";

/// Resolves the futures payment (collateral) token address.
///
/// The Futures contract no longer exposes the token directly — it lives on the
/// CollateralVault. We chain two reads:
///   1. `Futures.collateralVault()`   -> vault address (cached, immutable)
///   2. `CollateralVault.collateralToken()` -> ERC20 token address (also immutable)
///
/// Cached forever; safe to call from many places (wagmi dedupes the read).
export function useFuturePaymentToken() {
  const { data: collateralVaultAddress } = useFuturesCollateralVault();

  return useReadContract({
    address: collateralVaultAddress,
    abi: CollateralVaultAbi,
    functionName: "collateralToken",
    query: {
      enabled: !!collateralVaultAddress,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
}
