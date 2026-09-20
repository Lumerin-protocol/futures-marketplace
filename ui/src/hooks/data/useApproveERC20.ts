import { useWriteContract, useWalletClient } from "wagmi";
import { erc20Abi, getContract } from "viem";
import { useCallback } from "react";
import { withErrors } from "../../lib/withErrors";
import { retryUntilBlockAvailable } from "../../lib/retryUntilBlockAvailable";

interface ApproveProps {
  spender: `0x${string}`;
  amount: bigint;
  /**
   * Block a prior step's tx was mined in. When set, the allowance read and
   * approve simulation are pinned to this block (with retries while the node
   * catches up) instead of `latest`, which otherwise can race the just-mined
   * tx — see `retryUntilBlockAvailable`.
   */
  minBlockNumber?: bigint;
}

/// Resolves to `undefined` only when the existing allowance already covers the
/// amount — every other dead end throws, so callers can treat `undefined` as
/// "no approval needed" without it doubling as "wallet missing".
export function useApproveERC20(tokenAddress: `0x${string}` | undefined) {
  const { writeContractAsync, ...rest } = useWriteContract();
  const { data: wc } = useWalletClient();

  const approveAsync = useCallback(
    async (props: ApproveProps) => {
      if (!wc) throw new Error("Wallet not ready. Please try again.");
      if (!tokenAddress) throw new Error("Token address not loaded yet. Please try again.");

      const token = getContract({
        address: tokenAddress,
        abi: withErrors(erc20Abi),
        client: wc,
      });

      const readOpts = props.minBlockNumber !== undefined ? { blockNumber: props.minBlockNumber } : {};

      // Check current allowance
      const currentAllowance = await retryUntilBlockAvailable(() =>
        token.read.allowance([wc.account.address, props.spender], readOpts),
      );

      // If current allowance is sufficient, return undefined
      if (currentAllowance >= props.amount) {
        return undefined;
      }

      const req = await retryUntilBlockAvailable(() =>
        token.simulate.approve([props.spender, props.amount], {
          account: wc.account.address,
          ...readOpts,
        }),
      );

      return writeContractAsync(req.request);
    },
    [writeContractAsync, wc, tokenAddress],
  );

  return {
    ...rest,
    approveAsync,
  };
}
