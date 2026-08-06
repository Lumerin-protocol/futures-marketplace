import { useReadContracts } from "wagmi";
import { FuturesAbi } from "futures-marketplace-abi/Futures.ts";
import { withErrors } from "../../lib/withErrors";

const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}` | undefined;

/** Basis-point denominator, matching `BPS` in the contracts. */
const BPS = 10_000n;

/**
 * Reads the maker and taker fee rates from the Futures contract.
 *
 * Both are signed basis points of the filled notional — `notional * bps / 10000`,
 * where notional is `price * contracts`. Signed because a maker rebate is
 * expressed as a negative rate, which is why `worstCaseFeeBps` is a max rather
 * than an absolute value: a rebate costs the trader nothing to reserve.
 *
 * - `makerFeeBps` is paid by the resting order's owner when their order is filled.
 * - `takerFeeBps` is paid by the incoming caller on a matching fill.
 * - `feeFor(notional)` reserves the worse of the two. At submit time we don't yet
 *   know whether the order will match (taker) or rest and later fill (maker), so
 *   the larger rate is the only safe amount to hold back from IM headroom.
 */
export function useMakerTakerFees() {
  const result = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: withErrors(FuturesAbi),
        functionName: "makerFeeBps",
      },
      {
        address: futuresAddress,
        abi: withErrors(FuturesAbi),
        functionName: "takerFeeBps",
      },
    ],
    query: {
      enabled: !!futuresAddress,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });

  const makerFeeBps = result.data?.[0]?.result as number | undefined;
  const takerFeeBps = result.data?.[1]?.result as number | undefined;
  const worstCaseFeeBps =
    makerFeeBps !== undefined && takerFeeBps !== undefined
      ? Math.max(makerFeeBps, takerFeeBps)
      : undefined;

  /// Fee to reserve against a notional (token decimals). Zero while the rates
  /// are still loading, and never negative — a rebate is not spendable headroom.
  const feeFor = (notional: bigint): bigint => {
    if (worstCaseFeeBps === undefined || worstCaseFeeBps <= 0) return 0n;
    return (notional * BigInt(worstCaseFeeBps)) / BPS;
  };

  return {
    ...result,
    makerFeeBps,
    takerFeeBps,
    worstCaseFeeBps,
    feeFor,
    makerFeePercent: makerFeeBps !== undefined ? makerFeeBps / 100 : null,
    takerFeePercent: takerFeeBps !== undefined ? takerFeeBps / 100 : null,
    dataFetchedAt: result.dataUpdatedAt ? new Date(result.dataUpdatedAt) : undefined,
  };
}
