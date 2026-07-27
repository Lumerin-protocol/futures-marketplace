import { useReadContract } from "wagmi";
import { HashPowerPerpsDEXAbi } from "../../../abi/Perps";
import { withErrors } from "../../../lib/withErrors";

export function useMaintenanceMarginPercent() {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(HashPowerPerpsDEXAbi),
    functionName: "maintenanceMarginPercent",
    query: {
      staleTime: Infinity,
    },
  });
}
