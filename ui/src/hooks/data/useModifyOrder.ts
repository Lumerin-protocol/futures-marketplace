import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { encodeFunctionData, getContract } from "viem";
import { FuturesAbi } from "../../abi/Futures";

interface ModifyOrderProps {
  oldPrice: bigint;
  oldQuantity: number; // Current quantity (positive for Buy, negative for Sell)
  newPrice: bigint;
  newQuantity: number; // New quantity (positive for Buy, negative for Sell)
  expirationAt: bigint;
}

export function useModifyOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const modifyOrderAsync = async (props: ModifyOrderProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const futuresContract = getContract({
      address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
      abi: FuturesAbi,
      client: publicClient,
    });

    const oppositeOldQuantity = -props.oldQuantity;

    const calldata = [
      encodeFunctionData({
        abi: FuturesAbi,
        functionName: "createOrder",
        args: [props.oldPrice, props.expirationAt, BigInt(oppositeOldQuantity)],
      }),
      encodeFunctionData({
        abi: FuturesAbi,
        functionName: "createOrder",
        args: [props.newPrice, props.expirationAt, BigInt(props.newQuantity)],
      }),
    ];

    const req = await futuresContract.simulate.multicall([calldata], {
      account: walletClient.account.address,
    });

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
