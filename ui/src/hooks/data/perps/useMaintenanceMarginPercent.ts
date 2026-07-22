import { useReadContract } from "wagmi";
import { HashPowerPerpsDEXAbi } from "../../../abi/Perps";

export function useMaintenanceMarginPercent() {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
    abi: HashPowerPerpsDEXAbi,
    functionName: "maintenanceMarginPercent",
    query: {
      staleTime: Infinity,
    },
  });
}
