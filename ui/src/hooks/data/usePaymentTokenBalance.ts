import { usdcMockAbi } from "contracts-js/dist/abi/abi";
import { FuturesABI } from "../../abi/Futures";
import { useReadContract } from "wagmi";
import { backgroundRefetchOpts } from "./config";

function usePaymentTokenAddress() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS,
    abi: FuturesABI,
    functionName: "token",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  });
}

export function useFuturesPaymentTokenBalance(address: `0x${string}` | undefined) {
  const { data: paymentTokenAddress } = usePaymentTokenAddress();

  // Read balance using the payment token address
  return useReadContract({
    address: paymentTokenAddress,
    abi: usdcMockAbi,
    functionName: "balanceOf",
    args: [address!],
    query: {
      ...backgroundRefetchOpts,
      enabled: !!address && !!paymentTokenAddress,
    },
  });
}
