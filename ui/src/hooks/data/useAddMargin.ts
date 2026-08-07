import { useWriteContract, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { CollateralVaultAbi } from "collateral-margin-abi/CollateralVault.ts";
import { useApproveERC20 } from "./useApproveERC20";
import { useFuturePaymentToken } from "./useFuturePaymentToken";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";
import { usePermit, type PermitSignature } from "./usePermit";
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

interface AddMarginWithPermitProps {
  amount: bigint;
  deadline: bigint;
  signature: PermitSignature;
  /** Account to credit the deposit to — the connected wallet for self-deposits. */
  recipient: `0x${string}`;
}

/// ERC20 approval flow for futures deposits. The spender must be the
/// CollateralVault (NOT the Futures contract) since `vault.deposit` pulls the
/// underlying token via `transferFrom(msg.sender, vault, amount)`.
export function useApproveAddMargin() {
  const { data: tokenAddress } = useFuturePaymentToken();

  return useApproveERC20(tokenAddress);
}

/// EIP-2612 permit signing for the futures payment token, scoped to the
/// CollateralVault as spender. Pairs with `useAddMarginWithPermit` to collapse
/// the approve+deposit sequence into a single on-chain transaction (the
/// approval happens via an off-chain signature instead of its own tx) — see
/// `CollateralVault.depositForPermit`. `isSupported` tells callers whether to
/// fall back to `useApproveAddMargin`/`useAddMargin` for tokens that don't
/// implement EIP-2612.
export function usePermitAddMargin() {
  const { data: tokenAddress } = useFuturePaymentToken();
  const { data: vaultAddress } = useFuturesCollateralVault();

  return usePermit({
    tokenAddress: tokenAddress as `0x${string}` | undefined,
    spenderAddress: vaultAddress as `0x${string}` | undefined,
  });
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

/// Deposits collateral in a single tx via `vault.depositForPermit`, which
/// calls the token's EIP-2612 `permit()` (using the signature from
/// `usePermitAddMargin().signPermit`) and then pulls+credits the deposit —
/// no separate on-chain approve, and no RPC-drift window between an approve
/// and a subsequent read/simulate since there's only one on-chain write.
export function useAddMarginWithPermit() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const { data: collateralVaultAddress } = useFuturesCollateralVault();

  const addMarginWithPermitAsync = async (props: AddMarginWithPermitProps) => {
    if (!writeContractAsync || !walletClient || !collateralVaultAddress) return;

    const vault = getContract({
      address: collateralVaultAddress,
      abi: withErrors(CollateralVaultAbi),
      client: walletClient,
    });

    const { amount, deadline, signature, recipient } = props;
    const req = await vault.simulate.depositForPermit(
      [recipient, amount, deadline, signature.v, signature.r, signature.s],
      { account: walletClient.account.address },
    );

    return writeContractAsync(req.request);
  };

  return {
    addMarginWithPermitAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
