import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { PerpsABI } from "../../../abi/Perps";

interface CreatePerpsOrderProps {
  price: bigint;
  quantity: number; // Positive for Buy, Negative for Sell
}

export function useCreatePerpsOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const createOrderAsync = async (props: CreatePerpsOrderProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: PerpsABI,
      client: publicClient,
    });

    // Convert quantity to bigint (int256 in contract)
    // Contract expects: positive = Buy, negative = Sell
    const quantityBigInt = BigInt(props.quantity);

    const req = await perpsContract.simulate.createOrder(
      [props.price, quantityBigInt],
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
