import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { TimeInForce, type TimeInForceValue } from "../../types/timeInForce";
import { withErrors } from "../../lib/withErrors";

/** One leg of the `_intents` argument. */
export interface FuturesOrderIntent {
  price: bigint;
  expirationAt: bigint;
  /** Signed whole-contract quantity: positive = buy/long, negative = sell/short. */
  quantity: bigint;
  /** Defaults to GTC. */
  timeInForce?: TimeInForceValue;
}

/** One leg of the `_reduces` argument. */
export interface FuturesReduceIntent {
  orderId: `0x${string}`;
  /** Signed, strictly smaller in magnitude than the resting quantity. */
  newQuantity: bigint;
}

interface UpdateFuturesOrdersProps {
  cancelIds?: `0x${string}`[];
  reduces?: FuturesReduceIntent[];
  creates?: FuturesOrderIntent[];
}

/**
 * The full `updateOrders(cancelIds, reduces, intents)` surface.
 *
 * Cancels and reduces run before the creates, so freed margin is available to
 * them, and a batch without creates skips the portfolio IM check entirely —
 * which is what lets a margin-constrained account still shrink its book.
 */
export function useUpdateFuturesOrders() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const updateOrdersAsync = async (props: UpdateFuturesOrdersProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const cancelIds = props.cancelIds ?? [];
    const reduces = props.reduces ?? [];
    const creates = props.creates ?? [];
    if (cancelIds.length === 0 && reduces.length === 0 && creates.length === 0) {
      throw new Error("updateOrders requires at least one cancel, reduce or create");
    }

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(HashPowerFuturesAbi),
      client: publicClient,
    });

    const intents = creates.map((create) => ({
      price: create.price,
      expirationAt: create.expirationAt,
      quantity: create.quantity,
      timeInForce: create.timeInForce ?? TimeInForce.GTC,
    }));

    const req = await futuresContract.simulate.updateOrders([cancelIds, reduces, intents], {
      account: walletClient.account.address,
    });

    return writeContractAsync(req.request);
  };

  return {
    updateOrdersAsync,
    isPending,
    isError,
    error,
    hash,
  };
}

interface ModifyOrderProps {
  /** Resting order ids to cancel before placing the replacement. */
  orderIds: `0x${string}`[];
  newPrice: bigint;
  /** Signed whole-contract quantity: positive = buy/long, negative = sell/short. */
  newQuantity: number | bigint;
  expirationAt: bigint;
}

/** Cancel then place via a single `updateOrders` (one IM check). */
export function useModifyOrder() {
  const { updateOrdersAsync, isPending, isError, error, hash } = useUpdateFuturesOrders();

  const modifyOrderAsync = async (props: ModifyOrderProps) => {
    const quantity = BigInt(props.newQuantity);
    if (props.orderIds.length === 0) {
      throw new Error("orderIds must be non-empty");
    }
    if (quantity === 0n) {
      throw new Error("quantity must be non-zero");
    }

    return updateOrdersAsync({
      cancelIds: props.orderIds,
      creates: [
        {
          price: props.newPrice,
          expirationAt: props.expirationAt,
          quantity,
        },
      ],
    });
  };

  return {
    modifyOrderAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
