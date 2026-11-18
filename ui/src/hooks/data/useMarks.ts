import { useReadContracts } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { withErrors } from "../../lib/withErrors";
import type { ContractMode } from "../../types/types";

const futuresAbi = withErrors(HashPowerFuturesAbi);
const perpsAbi = withErrors(HashPowerPerpsDEXAbi);

const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}` | undefined;
const perpsAddress = process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}` | undefined;

export type HeaderMark = {
  /** Futures `getMarketPrice`, the index the header compares a mark against. */
  index: bigint | undefined;
  /**
   * Futures `getMarkRange` for the selected expiry. Longs and bids are valued at
   * `low`, shorts and asks at `high`. Both are the index unless the expiry
   * settles after the next halving (both about half of it) or inside the window
   * around its estimate (`low` post-halving, `high` the index).
   */
  low: bigint | undefined;
  high: bigint | undefined;
  /** Perps `getMarketPrice`: the halving glide, the index outside its last week. */
  perpsMark: bigint | undefined;
};

const readBigint = (entry: { status: string; result?: unknown } | undefined): bigint | undefined =>
  entry?.status === "success" && typeof entry.result === "bigint" ? entry.result : undefined;

/**
 * The index and the selected market's mark, from one multicall.
 *
 * They used to be separate 10s polls. After an oracle update one moved and the
 * other had not, so the header's "only when the mark departs from the index"
 * rule flashed Mark on markets where the two are equal. One `useReadContracts`
 * reads both in the same block, and the pair replaces the previous pair together.
 */
export function useHeaderMark(contractMode: ContractMode, selectedExpirationAt?: number): HeaderMark {
  const expiration = selectedExpirationAt !== undefined ? BigInt(selectedExpirationAt) : undefined;
  const isPerpetual = contractMode === "perpetual";

  const result = useReadContracts({
    contracts: isPerpetual
      ? [
          { address: futuresAddress, abi: futuresAbi, functionName: "getMarketPrice" },
          { address: perpsAddress, abi: perpsAbi, functionName: "getMarketPrice" },
        ]
      : [
          { address: futuresAddress, abi: futuresAbi, functionName: "getMarketPrice" },
          {
            address: futuresAddress,
            abi: futuresAbi,
            functionName: "getMarkRange",
            args: [expiration ?? 0n],
          },
        ],
    query: {
      enabled: isPerpetual ? !!futuresAddress && !!perpsAddress : expiration !== undefined && !!futuresAddress,
      refetchInterval: 10_000,
    },
  });

  const index = readBigint(result.data?.[0]);
  if (isPerpetual) {
    return { index, low: undefined, high: undefined, perpsMark: readBigint(result.data?.[1]) };
  }

  const range = result.data?.[1];
  const pair =
    range?.status === "success" && Array.isArray(range.result) ? (range.result as readonly [bigint, bigint]) : undefined;
  return { index, low: pair?.[0], high: pair?.[1], perpsMark: undefined };
}
