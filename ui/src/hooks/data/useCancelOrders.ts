import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { withErrors } from "../../lib/withErrors";
import type { ContractMode } from "../../types/types";

interface CancelOrdersProps {
  orderIds: `0x${string}`[];
}

export type CancelOrdersResult =
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

/**
 * Split order ids into those still resting for `account` and those that have
 * already left the book.
 *
 * The open-orders list comes from the indexer, which trails the chain by a
 * poll interval plus indexing lag, and one row collapses several ids. Any of
 * them may already be filled, self-crossed, liquidated or swept by the time
 * the user clicks. `updateOrders` is atomic, so a single such id reverts the
 * whole batch and cancels nothing — and it reverts as `OrderNotBelongToSender`,
 * because cancelling a deleted order compares the sender against the zeroed-out
 * participant. Drop ids we can see are gone and cancel the rest. A read failure
 * throws rather than dropping the id: only positively-missing orders are skipped.
 */
export async function partitionRestingOrderIds(
  orderIds: `0x${string}`[],
  account: `0x${string}`,
  getOrder: (id: `0x${string}`) => Promise<{ participant: `0x${string}`; quantity: bigint }>,
): Promise<{ cancellableIds: `0x${string}`[]; staleIds: `0x${string}`[] }> {
  const onChain = await Promise.all(orderIds.map((id) => getOrder(id)));
  const cancellableIds: `0x${string}`[] = [];
  const staleIds: `0x${string}`[] = [];
  orderIds.forEach((id, index) => {
    const order = onChain[index];
    const isRestingForSender = order.quantity !== 0n && order.participant.toLowerCase() === account.toLowerCase();
    if (isRestingForSender) {
      cancellableIds.push(id);
    } else {
      staleIds.push(id);
    }
  });
  return { cancellableIds, staleIds };
}

/**
 * Cancel resting orders in one transaction via `updateOrders(ids, [], [])`.
 * Both venues expose the same `getOrder` / `updateOrders` shape, so the hook
 * only differs in which contract it talks to.
 */
export function useCancelOrders(contractMode: ContractMode = "futures") {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const cancelOrdersAsync = async (props: CancelOrdersProps): Promise<CancelOrdersResult> => {
    if (!writeContractAsync || !publicClient || !walletClient) return { status: "not-ready" };
    if (props.orderIds.length === 0) return { status: "already-closed", staleIds: [] };

    const account = walletClient.account.address;
    // Two contracts rather than one union: viem's generics do not unify the two
    // ABIs (their `ReduceIntent` structs are distinct types), so each call site
    // below picks the venue explicitly.
    const futures = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(HashPowerFuturesAbi),
      client: publicClient,
    });
    const perps = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(HashPowerPerpsDEXAbi),
      client: publicClient,
    });
    const isPerps = contractMode === "perpetual";

    const { cancellableIds, staleIds } = await partitionRestingOrderIds(props.orderIds, account, (id) =>
      isPerps ? perps.read.getOrder([id]) : futures.read.getOrder([id]),
    );

    if (cancellableIds.length === 0) return { status: "already-closed", staleIds };

    const txhash = isPerps
      ? await writeContractAsync(
          (await perps.simulate.updateOrders([cancellableIds, [], []], { account })).request,
        )
      : await writeContractAsync(
          (await futures.simulate.updateOrders([cancellableIds, [], []], { account })).request,
        );
    return { status: "sent", txhash, cancelledIds: cancellableIds, staleIds };
  };

  return {
    cancelOrdersAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
