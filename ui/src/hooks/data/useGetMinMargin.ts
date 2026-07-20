import { useReadContract } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";

/**
 * Resting-order margin contribution for a participant (Futures 3.0).
 * Replaces the removed `getMinMargin` view — portfolio MM is on the PME;
 * this is the venue's order-margin leg.
 */
export function useGetMinMargin(address: `0x${string}` | undefined) {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS,
    abi: FuturesAbi,
    functionName: "getFuturesOrderMargin",
    args: [address!],
    query: {
      enabled: !!address,
      refetchInterval: 10000,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
    },
  });
}
