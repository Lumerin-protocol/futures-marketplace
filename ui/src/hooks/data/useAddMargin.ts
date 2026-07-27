import { useWriteContract, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { CollateralVaultAbi } from "../../abi/ICollateralVault";
import { withErrors } from "../../lib/withErrors";
import { useApproveERC20 } from "./useApproveERC20";
import { useFuturePaymentToken } from "./useFuturePaymentToken";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";

interface AddMarginProps {
  amount: bigint;
}

/// ERC20 approval flow for futures deposits. The spender must be the
/// CollateralVault (NOT the Futures contract) since `vault.deposit` pulls the
/// underlying token via `transferFrom(msg.sender, vault, amount)`.
export function useApproveAddMargin() {
  const { data: tokenAddress } = useFuturePaymentToken();

  return useApproveERC20(tokenAddress!);
}

/// Deposits collateral into the futures CollateralVault by calling
/// `vault.deposit(amount)` directly. The vault address is resolved through
/// `useFuturesCollateralVault` (same chain as `useGetFutureBalance`).
export function useAddMargin() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const { data: collateralVaultAddress } = useFuturesCollateralVault();

  const addMarginAsync = async (props: AddMarginProps) => {
    if (!writeContractAsync || !walletClient || !collateralVaultAddress) return;

    const vault = getContract({
      address: collateralVaultAddress,
      abi: withErrors(CollateralVaultAbi),
      client: walletClient,
    });

    const req = await vault.simulate.deposit([props.amount], {
      account: walletClient.account.address,
    });

    return writeContractAsync(req.request);
  };

  return {
    addMarginAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
