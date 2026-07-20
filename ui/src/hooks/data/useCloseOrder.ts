import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { FuturesAbi } from "../../abi/Futures";

interface CloseOrdersProps {
  orderIds: `0x${string}`[];
}

/** Cancel resting futures orders (`cancelOrder` on-chain). */
export function useCloseOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const closeOrdersAsync = async (props: CloseOrdersProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: FuturesAbi,
      client: publicClient,
    });

    const receipts: unknown[] = [];
    for (const orderId of props.orderIds) {
      const req = await futuresContract.simulate.cancelOrder([orderId], {
        account: walletClient.account.address,
      });

      const tx = await writeContractAsync(req.request);
      receipts.push(tx);
    }

    return receipts;
  };

  return {
    closeOrdersAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
