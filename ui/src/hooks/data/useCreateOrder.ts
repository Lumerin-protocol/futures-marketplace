import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { FuturesAbi } from "../../abi/Futures";
import { withErrors } from "../../lib/withErrors";
import { TimeInForce, type TimeInForceValue } from "../../types/timeInForce";

interface CreateOrderProps {
  price: bigint;
  /** Signed whole-contract quantity: positive = buy/long, negative = sell/short. */
  quantity: number | bigint;
  expirationAt: bigint;
  /** Defaults to GTC. */
  timeInForce?: TimeInForceValue;
}

export function useCreateOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const createOrderAsync = async (props: CreateOrderProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(FuturesAbi),
      client: publicClient,
    });

    const quantity = BigInt(props.quantity);
    if (quantity === 0n) {
      throw new Error("quantity must be non-zero");
    }

    const tif = props.timeInForce ?? TimeInForce.GTC;

    const req = await futuresContract.simulate.createOrderV2(
      [props.price, props.expirationAt, quantity, tif],
      { account: walletClient.account.address },
    );

    return writeContractAsync(req.request);
  };

  return {
    createOrderAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
