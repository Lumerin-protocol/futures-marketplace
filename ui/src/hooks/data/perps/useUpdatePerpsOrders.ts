import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { QUANTITY_SCALE_NUM } from "../../../lib/units";
import { TimeInForce } from "../../../types/timeInForce";
import { withErrors } from "../../../lib/withErrors";

/** One leg of the `_reduces` argument. */
export interface PerpsReduceIntent {
  orderId: `0x${string}`;
  /**
   * Signed, already scaled by `QUANTITY_SCALE`. Unlike the creates below this
   * takes raw units: the contract rejects a new quantity that is not strictly
   * smaller than the resting one, so a round trip through a decimal `number`
   * could round the value onto the boundary and revert.
   */
  newQuantity: bigint;
}

interface UpdatePerpsOrdersProps {
  cancelIds?: `0x${string}`[];
  reduces?: PerpsReduceIntent[];
  /** Signed decimal quantity (positive = buy/long, negative = sell/short). */
  creates?: Array<{ price: bigint; quantity: number }>;
}

/** Cancel, reduce then place via a single perps `updateOrders` (one IM check). */
export function useUpdatePerpsOrders() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const updateOrdersAsync = async (props: UpdatePerpsOrdersProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const cancelIds = props.cancelIds ?? [];
    const reduces = props.reduces ?? [];
    const creates = props.creates ?? [];
    if (cancelIds.length === 0 && reduces.length === 0 && creates.length === 0) {
      throw new Error("updateOrders requires at least one cancel, reduce or create");
    }

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(HashPowerPerpsDEXAbi),
      client: publicClient,
    });

    const intents = creates.map((c) => ({
      price: c.price,
      quantity: BigInt(Math.round(c.quantity * QUANTITY_SCALE_NUM)),
      timeInForce: TimeInForce.GTC,
    }));

    const req = await perpsContract.simulate.updateOrders([cancelIds, reduces, intents], {
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
