import { useReadContract } from "wagmi";
import { PerpsABI } from "../../../abi/Perps";

export function useMaintenanceMarginPercent() {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
    abi: PerpsABI,
    functionName: "maintenanceMarginPercent",
    query: {
      staleTime: Infinity,
    },
  });
}
