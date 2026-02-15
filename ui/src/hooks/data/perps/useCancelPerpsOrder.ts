import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { PerpsABI } from "../../../abi/Perps";

interface CancelPerpsOrderProps {
  orderId: `0x${string}`;
}

export function useCancelPerpsOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const cancelOrderAsync = async (props: CancelPerpsOrderProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: PerpsABI,
      client: publicClient,
    });

    const req = await perpsContract.simulate.cancelOrder(
      [props.orderId],
      { account: walletClient.account.address },
    );

    return writeContractAsync(req.request);
  };

  return {
    cancelOrderAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
