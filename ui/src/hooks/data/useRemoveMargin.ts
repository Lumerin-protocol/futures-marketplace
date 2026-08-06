import { useWriteContract, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { CollateralVaultAbi } from "collateral-margin-abi/CollateralVault.ts";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";
import { withErrors } from "../../lib/withErrors";

interface RemoveMarginProps {
  amount: bigint;
}

/// Withdraws collateral from the futures CollateralVault by calling
/// `vault.withdraw(amount)` directly. The vault address is resolved through
/// `useFuturesCollateralVault` (same chain as `useGetFutureBalance`).
export function useRemoveMargin() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const { data: collateralVaultAddress } = useFuturesCollateralVault();

  const removeMarginAsync = async (props: RemoveMarginProps) => {
    if (!writeContractAsync || !walletClient || !collateralVaultAddress) return;

    const vault = getContract({
      address: collateralVaultAddress,
      abi: withErrors(CollateralVaultAbi),
      client: walletClient,
    });

    const req = await vault.simulate.withdraw([props.amount], {
      account: walletClient.account.address,
    });

    return writeContractAsync(req.request);
  };

  return {
    removeMarginAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
