import { useReadContracts } from "wagmi";
import { PointsHookAbi } from "../../abi/PointsHook";
import { useFuturesHook } from "./useFuturesHook";
import { withErrors } from "../../lib/withErrors";

/// Reads the points-weighting parameters from the Futures `hook` (IPointsHook):
///   - `WEIGHT_SCALE` — fixed-point denominator for the weights.
///   - `wTaker` — weight applied to taker volume.
///   - `wMaker` — weight applied to maker volume.
///
/// The hook address is resolved via `useFuturesHook`, so this read is gated
/// until that address is available. Points for a given trade are computed as:
///   points = weight * size / WEIGHT_SCALE
export function usePointsHookWeights() {
  const { data: hookAddress } = useFuturesHook();

  const result = useReadContracts({
    contracts: [
      {
        address: hookAddress,
        abi: withErrors(PointsHookAbi),
        functionName: "WEIGHT_SCALE",
      },
      {
        address: hookAddress,
        abi: withErrors(PointsHookAbi),
        functionName: "wTaker",
      },
      {
        address: hookAddress,
        abi: withErrors(PointsHookAbi),
        functionName: "wMaker",
      },
    ],
    query: {
      enabled: !!hookAddress,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });

  const weightScale = result.data?.[0]?.result as bigint | undefined;
  const wTaker = result.data?.[1]?.result as bigint | undefined;
  const wMaker = result.data?.[2]?.result as bigint | undefined;

  return {
    ...result,
    hookAddress,
    weightScale,
    wTaker,
    wMaker,
  };
}
