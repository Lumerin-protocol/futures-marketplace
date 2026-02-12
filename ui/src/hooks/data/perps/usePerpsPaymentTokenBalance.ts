import { usdcMockAbi } from "contracts-js/dist/abi/abi";
import { PerpsABI } from "../../../abi/Perps";
import { useReadContract } from "wagmi";
import { backgroundRefetchOpts } from "../config";

function usePaymentTokenAddress() {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS,
    abi: PerpsABI,
    functionName: "collateralToken",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  });
}

export function usePerpsPaymentTokenBalance(address: `0x${string}` | undefined) {
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
