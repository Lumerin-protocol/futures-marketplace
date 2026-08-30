import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { withErrors } from "../../lib/withErrors";

interface CloseOrdersProps {
  orderIds: `0x${string}`[];
}

export type CloseOrdersResult =
  /** No wallet / client yet — nothing was attempted. */
  | { status: "not-ready" }
  /** Every id had already left the book, so no transaction was sent. */
  | { status: "already-closed"; staleIds: `0x${string}`[] }
  /** Cancel submitted for `cancelledIds`; `staleIds` were dropped as already gone. */
  | {
      status: "sent";
      txhash: `0x${string}`;
      cancelledIds: `0x${string}`[];
      staleIds: `0x${string}`[];
    };

/** Cancel resting futures orders via `updateOrders(ids, [], [])`. */
export function useCloseOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const closeOrdersAsync = async (props: CloseOrdersProps): Promise<CloseOrdersResult> => {
    if (!writeContractAsync || !publicClient || !walletClient) return { status: "not-ready" };
    if (props.orderIds.length === 0) return { status: "already-closed", staleIds: [] };

    const account = walletClient.account.address;
    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(HashPowerFuturesAbi),
      client: publicClient,
    });

    // The open-orders list comes from the indexer, which trails the chain by a
    // poll interval plus indexing lag, and one row collapses several ids. Any
    // of them may already be filled, self-crossed, liquidated or swept by the
    // time the user clicks. `updateOrders` is atomic, so a single such id
    // reverts the whole batch and cancels nothing — and it reverts as
    // `OrderNotBelongToSender`, because cancelling a deleted order compares the
    // sender against the zeroed-out participant. Drop ids we can see are gone
    // and cancel the rest. A read failure throws rather than dropping the id:
    // only positively-missing orders are skipped.
    const onChain = await Promise.all(props.orderIds.map((id) => futuresContract.read.getOrder([id])));

    const cancellableIds: `0x${string}`[] = [];
    const staleIds: `0x${string}`[] = [];
    props.orderIds.forEach((id, index) => {
      const order = onChain[index];
      const isRestingForSender =
        order.quantity !== 0n && order.participant.toLowerCase() === account.toLowerCase();
      if (isRestingForSender) {
        cancellableIds.push(id);
      } else {
        staleIds.push(id);
      }
    });

    if (cancellableIds.length === 0) return { status: "already-closed", staleIds };

    const req = await futuresContract.simulate.updateOrders([cancellableIds, [], []], {
      account,
    });

    const txhash = await writeContractAsync(req.request);
    return { status: "sent", txhash, cancelledIds: cancellableIds, staleIds };
  };

  return {
    closeOrdersAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
