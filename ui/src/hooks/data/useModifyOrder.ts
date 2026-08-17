import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { TimeInForce } from "../../types/timeInForce";
import { withErrors } from "../../lib/withErrors";

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
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const modifyOrderAsync = async (props: ModifyOrderProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(HashPowerFuturesAbi),
      client: publicClient,
    });

    const quantity = BigInt(props.newQuantity);
    if (props.orderIds.length === 0) {
      throw new Error("orderIds must be non-empty");
    }
    if (quantity === 0n) {
      throw new Error("quantity must be non-zero");
    }

    const req = await futuresContract.simulate.updateOrders(
      [
        props.orderIds,
        [],
        [
          {
            price: props.newPrice,
            expirationAt: props.expirationAt,
            quantity,
            timeInForce: TimeInForce.GTC,
          },
        ],
      ],
      { account: walletClient.account.address },
    );

    return writeContractAsync(req.request);
  };

  return {
    modifyOrderAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
