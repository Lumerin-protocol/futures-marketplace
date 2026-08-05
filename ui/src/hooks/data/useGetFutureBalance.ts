import { useReadContract } from "wagmi";
import { CollateralVaultAbi } from "collateral-margin-abi/CollateralVault.ts";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";

/// Reads the user's deposited collateral balance from the CollateralVault.
/// The vault address is fetched from `Futures.collateralVault()`, then
/// `balanceOf(account)` is called against the vault using `CollateralVaultAbi`.
export function useGetFutureBalance(address: `0x${string}` | undefined) {
  const { data: collateralVaultAddress } = useFuturesCollateralVault();

  return useReadContract({
    address: collateralVaultAddress,
    abi: CollateralVaultAbi,
    functionName: "balanceOf",
    args: [address!],
    query: {
      enabled: !!address && !!collateralVaultAddress,
    },
  });
}
