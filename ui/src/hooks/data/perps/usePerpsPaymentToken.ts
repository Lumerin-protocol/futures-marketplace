import { useReadContract } from "wagmi";
import { CollateralVaultAbi } from "collateral-margin-abi/CollateralVault.ts";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";

/// Resolves the collateral token in two hops: the perps DEX names its vault,
/// and the vault owns the token. Collateral moved to the shared vault when the
/// venues went cross-margin, so the DEX no longer holds a token address itself.
export function usePerpsPaymentToken() {
  const { data: vault } = useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}` | undefined,
    abi: HashPowerPerpsDEXAbi,
    functionName: "vault",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  });

  return useReadContract({
    address: vault,
    abi: CollateralVaultAbi,
    functionName: "collateralToken",
    query: {
      enabled: !!vault,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  });
}
