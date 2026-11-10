import { useReadContract } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { withErrors } from "../../lib/withErrors";

/**
 * A futures expiry's mark range (`getMarkRange`, token decimals): longs and bids are
 * valued at `low`, shorts and asks at `high`. Both are the index unless the expiry
 * settles after the next halving (both about half of it) or inside the window around
 * its estimate (`low` post-halving, `high` the index).
 */
export function useFuturesMarkRange(expirationAt: bigint | undefined) {
  const result = useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}` | undefined,
    abi: withErrors(HashPowerFuturesAbi),
    functionName: "getMarkRange",
    args: expirationAt !== undefined ? [expirationAt] : undefined,
    query: { enabled: expirationAt !== undefined, refetchInterval: 10000 },
  });
  const range = result.data as readonly [bigint, bigint] | undefined;
  return { low: range?.[0], high: range?.[1], isLoading: result.isLoading };
}

/** The perps mark (`getMarketPrice`): the halving glide, the index outside its last week. */
export function usePerpsMarkPrice(enabled = true) {
  const result = useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}` | undefined,
    abi: withErrors(HashPowerPerpsDEXAbi),
    functionName: "getMarketPrice",
    query: { enabled, refetchInterval: 10000 },
  });
  return { mark: result.data as bigint | undefined, isLoading: result.isLoading };
}
