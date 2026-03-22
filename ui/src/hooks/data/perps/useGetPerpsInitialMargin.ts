import { useReadContract } from "wagmi";
import { PerpsABI } from "../../../abi/Perps";

/**
 * Initial margin required for the user's open positions and resting orders (Perps contract view).
 * Use for withdrawal limits; typically higher than maintenance margin.
 */
export function useGetPerpsInitialMargin(
  address: `0x${string}` | undefined,
  options: { enabled: boolean },
) {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
    abi: PerpsABI,
    functionName: "getInitialMargin",
    args: address ? [address] : undefined,
    query: {
      enabled: options.enabled && !!address,
      refetchOnMount: true,
    },
  });
}
