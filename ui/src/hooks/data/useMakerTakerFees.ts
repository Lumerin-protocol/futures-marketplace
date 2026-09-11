import { useReadContracts } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { withErrors } from "../../lib/withErrors";

const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}` | undefined;

/** Basis-point denominator, matching `BPS` in the contracts. */
const BPS = 10_000n;

/**
 * Reserve for a notional at a venue's rates: the worse of maker/taker, since at
 * submit time it is not yet known whether the order matches (taker) or rests and
 * later fills (maker). A maker rebate is a negative rate and is floored at zero —
 * it is not spendable headroom.
 *
 * Split out from the hook because the two venues publish their rates in
 * different places: futures on the contract, perps on the subgraph collection.
 * The arithmetic is the same, so only the source should differ.
 */
export function feeReserverFor(
  makerFeeBps: number | undefined,
  takerFeeBps: number | undefined,
): (notional: bigint) => bigint {
  const worstCaseFeeBps =
    makerFeeBps !== undefined && takerFeeBps !== undefined
      ? Math.max(makerFeeBps, takerFeeBps)
      : undefined;

  return (notional: bigint): bigint => {
    if (worstCaseFeeBps === undefined || worstCaseFeeBps <= 0) return 0n;
    return (notional * BigInt(worstCaseFeeBps)) / BPS;
  };
}

/**
 * Reads the maker and taker fee rates from the Futures contract. Perps set their
 * own rates and publish them on the subgraph collection, so an order on that
 * venue must reserve through `feeReserverFor(collection...)` instead of this.
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
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "makerFeeBps",
      },
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
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
  const feeFor = feeReserverFor(makerFeeBps, takerFeeBps);

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
