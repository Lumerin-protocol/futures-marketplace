import { useReadContract } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";

export function useGetFutureBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS,
    abi: FuturesAbi,
    functionName: "balanceOf",
    args: [address!],
  });
}
