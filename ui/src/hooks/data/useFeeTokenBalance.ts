import { useReadContract } from "wagmi";
import { backgroundRefetchOpts } from "./config";
import { cloneFactoryAbi, usdcMockAbi } from "contracts-js/dist/abi/abi";
import { withErrors } from "../../lib/withErrors";

export function useFeeTokenAddress() {
  return useReadContract({
    address: process.env.REACT_APP_CLONE_FACTORY,
    abi: withErrors(cloneFactoryAbi),
    functionName: "feeToken",
    query: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  });
}

export function useFeeTokenBalance(address: `0x${string}` | undefined, refetch = true) {
  const { data: feeTokenAddress } = useFeeTokenAddress();

  return useReadContract({
    address: feeTokenAddress,
    abi: withErrors(usdcMockAbi),
    functionName: "balanceOf",
    args: [address!],
    query: {
      ...(refetch ? backgroundRefetchOpts : {}),
      enabled: !!address && !!feeTokenAddress,
    },
  });
}
