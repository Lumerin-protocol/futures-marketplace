import { useReadContract } from "wagmi";
import { HashPowerPerpsDEXAbi } from "../../../abi/Perps";

export function usePerpsPaymentToken() {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS,
    abi: HashPowerPerpsDEXAbi,
    functionName: "collateralToken",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  });
}
