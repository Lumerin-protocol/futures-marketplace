import { useReadContract } from "wagmi";
import { ICollateralVaultAbi } from "../../abi/ICollateralVault";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";

/// Reads the user's deposited collateral balance from the CollateralVault.
/// The vault address is fetched from `Futures.collateralVault()`, then
/// `balanceOf(account)` is called against the vault using `ICollateralVaultAbi`.
export function useGetFutureBalance(address: `0x${string}` | undefined) {
  const { data: collateralVaultAddress } = useFuturesCollateralVault();

  return useReadContract({
    address: collateralVaultAddress,
    abi: ICollateralVaultAbi,
    functionName: "balanceOf",
    args: [address!],
    query: {
      enabled: !!address && !!collateralVaultAddress,
    },
  });
}
