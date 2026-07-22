import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { FuturesAbi } from "../../abi/Futures";

interface CloseOrdersProps {
  orderIds: `0x${string}`[];
}

/** Cancel resting futures orders via `updateOrders(ids, [])`. */
export function useCloseOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const closeOrdersAsync = async (props: CloseOrdersProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;
    if (props.orderIds.length === 0) return [];

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: FuturesAbi,
      client: publicClient,
    });

    const req = await futuresContract.simulate.updateOrders([props.orderIds, []], {
      account: walletClient.account.address,
    });

    const tx = await writeContractAsync(req.request);
    return [tx];
  };

  return {
    closeOrdersAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
