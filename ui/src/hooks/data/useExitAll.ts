import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { withErrors } from "../../lib/withErrors";
import { TimeInForce } from "../../types/timeInForce";
import type { ContractMode } from "../../types/types";
import { partitionRestingOrderIds } from "./useCancelOrders";
import { closingIntent, type ExitAllClose, type ExitAllIntent } from "../../lib/exitAll";

export type { ExitAllClose, ExitAllIntent };

interface ExitAllProps {
  /** Resting order ids to pull; ids already off the book are dropped, not failed on. */
  cancelIds: `0x${string}`[];
  closes: ExitAllClose[];
  /** Native-unit mark the slippage cap is measured from. */
  marketPrice: bigint;
  /** e.g. 0.05 — how far past the mark a closing fill may go. */
  slippage: number;
  /** Native-unit tick the cap is snapped to. */
  priceStep: bigint;
}

export type ExitAllResult =
  /** No wallet / client yet — nothing was attempted. */
  | { status: "not-ready" }
  /** Nothing left to do: every order was already gone and there is no position. */
  | { status: "nothing"; staleIds: `0x${string}`[] }
  | {
      status: "sent";
      txhash: `0x${string}`;
      cancelledIds: `0x${string}`[];
      staleIds: `0x${string}`[];
      intents: ExitAllIntent[];
    };

/**
 * Leave a market entirely in one signature: cancel every resting order and
 * flatten every position via a single `updateOrders(cancelIds, [], intents)`.
 * Cancels run before creates inside the contract, so the margin they free is
 * available to the closing legs and the batch passes one IM check.
 */
export function useExitAll(contractMode: ContractMode = "futures") {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const exitAllAsync = async (props: ExitAllProps): Promise<ExitAllResult> => {
    if (!writeContractAsync || !publicClient || !walletClient) return { status: "not-ready" };

    const account = walletClient.account.address;
    const isPerps = contractMode === "perpetual";
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

    const { cancellableIds, staleIds } = await partitionRestingOrderIds(props.cancelIds, account, (id) =>
      isPerps ? perps.read.getOrder([id]) : futures.read.getOrder([id]),
    );

    const intents = props.closes
      .filter((c) => c.netQuantity !== 0n)
      .map((c) => closingIntent(c, props.marketPrice, props.slippage, props.priceStep));

    if (cancellableIds.length === 0 && intents.length === 0) return { status: "nothing", staleIds };

    const txhash = isPerps
      ? await writeContractAsync(
          (
            await perps.simulate.updateOrders(
              [
                cancellableIds,
                [],
                intents.map((i) => ({ price: i.price, quantity: i.quantity, timeInForce: TimeInForce.IOC })),
              ],
              { account },
            )
          ).request,
        )
      : await writeContractAsync(
          (
            await futures.simulate.updateOrders(
              [
                cancellableIds,
                [],
                intents.map((i) => ({
                  price: i.price,
                  expirationAt: i.expirationAt ?? 0n,
                  quantity: i.quantity,
                  timeInForce: TimeInForce.IOC,
                })),
              ],
              { account },
            )
          ).request,
        );

    return { status: "sent", txhash, cancelledIds: cancellableIds, staleIds, intents };
  };

  return { exitAllAsync, isPending, isError, error, hash };
}
