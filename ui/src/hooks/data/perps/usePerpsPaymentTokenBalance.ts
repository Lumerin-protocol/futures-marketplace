import { usdcMockAbi } from "contracts-js/dist/abi/abi";
import { useReadContract } from "wagmi";
import { backgroundRefetchOpts } from "../config";
import { usePerpsPaymentToken } from "./usePerpsPaymentToken";

export function usePerpsPaymentTokenBalance(address: `0x${string}` | undefined) {
  const { data: paymentTokenAddress } = usePerpsPaymentToken();

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
