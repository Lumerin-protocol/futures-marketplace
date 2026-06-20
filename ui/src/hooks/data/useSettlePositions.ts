import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { getContract } from "viem";
import { FuturesAbi } from "../../abi/Futures";
import { waitForBlockNumberPositionBook } from "./getUserFuturesPositions";

interface SettlePositionsProps {
  /// Expiration (deliveryAt) whose matured positions should be settled.
  deliveryAt: bigint;
  /// Participant whose positions to settle. Defaults to the connected wallet.
  participant?: `0x${string}`;
}

/**
 * Manual claim for a matured-but-unsettled expiration (used when the keeper is
 * inactive). Looks up the participant's open positions at `deliveryAt` via
 * `getPositionsByParticipantDeliveryDate` and cash-settles them in one
 * permissionless `settlePositions` tx, pinning the settlement price on first call.
 * Refetches the position book and waits for the indexer to catch up.
 */
export function useSettlePositions() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  const settlePositionsAsync = async ({ deliveryAt, participant }: SettlePositionsProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const account = participant ?? walletClient.account.address;

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: FuturesAbi,
      client: publicClient,
    });

    const positionIds = await futuresContract.read.getPositionsByParticipantDeliveryDate([
      account,
      deliveryAt,
    ]);

    if (positionIds.length === 0) {
      throw new Error("No open positions to settle for this expiration");
    }

    const req = await futuresContract.simulate.settlePositions([positionIds], {
      account: walletClient.account.address,
    });
    const tx = await writeContractAsync(req.request);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    await waitForBlockNumberPositionBook(receipt.blockNumber, queryClient);

    return tx;
  };

  return {
    settlePositionsAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
