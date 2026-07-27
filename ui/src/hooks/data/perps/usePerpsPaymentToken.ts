import { useReadContract } from "wagmi";
import { HashPowerPerpsDEXAbi } from "../../../abi/Perps";
import { withErrors } from "../../../lib/withErrors";

export function usePerpsPaymentToken() {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS,
    abi: withErrors(HashPowerPerpsDEXAbi),
    functionName: "collateralToken",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  });
}
