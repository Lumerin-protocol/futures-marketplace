import { useWriteContract } from "wagmi";
import { getContract } from "viem";
import { CollateralVaultAbi } from "collateral-margin-abi/CollateralVault.ts";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";
import { withErrors } from "../../lib/withErrors";
import { requireWalletClient } from "../../clients/requireWalletClient";

interface RemoveMarginProps {
  amount: bigint;
}

/// Withdraws collateral from the futures CollateralVault by calling
/// `vault.withdraw(amount)` directly. The vault address is resolved through
/// `useFuturesCollateralVault` (same chain as `useGetFutureBalance`).
export function useRemoveMargin() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const { data: collateralVaultAddress } = useFuturesCollateralVault();

  const removeMarginAsync = async (props: RemoveMarginProps) => {
    if (!collateralVaultAddress) {
      throw new Error("Collateral vault address not loaded yet. Please try again.");
    }
    const walletClient = await requireWalletClient();

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
