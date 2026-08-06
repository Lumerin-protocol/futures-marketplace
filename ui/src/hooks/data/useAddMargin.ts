import { useWriteContract, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { CollateralVaultAbi } from "collateral-margin-abi/CollateralVault.ts";
import { useApproveERC20 } from "./useApproveERC20";
import { useFuturePaymentToken } from "./useFuturePaymentToken";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";
import { withErrors } from "../../lib/withErrors";
import { retryUntilBlockAvailable } from "../../lib/retryUntilBlockAvailable";

interface AddMarginProps {
  amount: bigint;
  /**
   * Block the preceding approve tx was mined in. When set, the deposit
   * simulation is pinned to this block (with retries while the node catches
   * up) instead of `latest`, avoiding a race where allowance appears
   * unchanged right after the approve confirms. See `retryUntilBlockAvailable`.
   */
  minBlockNumber?: bigint;
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

    const req = await retryUntilBlockAvailable(() =>
      vault.simulate.deposit([props.amount], {
        account: walletClient.account.address,
        ...(props.minBlockNumber !== undefined ? { blockNumber: props.minBlockNumber } : {}),
      }),
    );

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
