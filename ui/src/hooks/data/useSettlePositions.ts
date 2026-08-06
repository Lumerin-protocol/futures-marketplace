import { usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import { getContract } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { FuturesAbi } from "futures-marketplace-abi/Futures.ts";
import { waitForBlockNumberPositionBook } from "./getUserFuturesPositions";
import { FUTURES_POSITION_HISTORY_QK } from "./useFuturesPositionHistory";
import { withErrors } from "../../lib/withErrors";

interface SettlePositionsProps {
  /// Expiration (expirationAt) whose matured aggregate position should be settled.
  expirationAt: bigint;
  /// Participant whose position to settle. Defaults to the connected wallet.
  participant?: `0x${string}`;
}

/**
 * Cash-settles the participant's aggregate net position at `expirationAt` via
 * permissionless `settlePosition(user, expirationAt)`, pinning the settlement
 * price on first call. Refetches the position book and waits for the indexer.
 */
export function useSettlePositions() {
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  const settlePositionsAsync = async ({ expirationAt, participant }: SettlePositionsProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) {
      throw new Error("Wallet not ready");
    }

    const account = participant ?? walletClient.account.address;

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(FuturesAbi),
      client: publicClient,
    });

    const pos = await futuresContract.read.getUserPosition([account, expirationAt]);
    if (pos.netQuantity === 0n) {
      throw new Error("No open position to settle for this expiration");
    }

    const req = await futuresContract.simulate.settlePosition([account, expirationAt], {
      account: walletClient.account.address,
    });
    const hash = await writeContractAsync(req.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    await waitForBlockNumberPositionBook(receipt.blockNumber, queryClient);

    queryClient.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, account] });

    return receipt;
  };

  return {
    settlePositionsAsync,
    isPending,
  };
}
