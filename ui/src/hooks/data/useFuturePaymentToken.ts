import { useReadContract } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";

export function useFuturePaymentToken() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS,
    abi: FuturesAbi,
    functionName: "token",
  });
}
