import { useReadContract } from "wagmi";
import { HashPowerPerpsDEXAbi } from "../../../abi/Perps";

/**
 * Hook to fetch the required margin for a user's perps positions and orders
 * @param address - The user's wallet address
 * @returns Query result with the required margin amount in wei (as bigint)
 */
export function useGetPerpsRequiredMargin(address: `0x${string}` | undefined) {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
    abi: HashPowerPerpsDEXAbi,
    functionName: "getMaintenanceMargin",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10000, // Refetch every 10 seconds to stay up-to-date
    },
  });
}
