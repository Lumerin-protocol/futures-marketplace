import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { QUANTITY_SCALE_NUM } from "../../../lib/units";
import { TimeInForce } from "../../../types/timeInForce";

interface UpdatePerpsOrdersProps {
  cancelIds: `0x${string}`[];
  /** Signed decimal quantity (positive = buy/long, negative = sell/short). */
  creates?: Array<{ price: bigint; quantity: number }>;
}

/** Cancel then place via a single perps `updateOrders` (one IM check). */
export function useUpdatePerpsOrders() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const updateOrdersAsync = async (props: UpdatePerpsOrdersProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: HashPowerPerpsDEXAbi,
      client: publicClient,
    });

    const intents = (props.creates ?? []).map((c) => ({
      price: c.price,
      quantity: BigInt(Math.round(c.quantity * QUANTITY_SCALE_NUM)),
      timeInForce: TimeInForce.GTC,
    }));

    const req = await perpsContract.simulate.updateOrders([props.cancelIds, [], intents], {
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
