import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { FuturesAbi } from "../../abi/Futures";
import { contractErrors } from "../../abi/contractErrors";

interface CreateOrderProps {
  price: bigint;
  /** Signed whole-contract quantity: positive = buy/long, negative = sell/short. */
  quantity: number | bigint;
  expirationAt: bigint;
}

export function useCreateOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const createOrderAsync = async (props: CreateOrderProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: [...FuturesAbi, ...contractErrors],
      client: publicClient,
    });

    const quantity = BigInt(props.quantity);
    if (quantity === 0n) {
      throw new Error("quantity must be non-zero");
    }

    const req = await futuresContract.simulate.createOrder(
      [props.price, props.expirationAt, quantity],
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
