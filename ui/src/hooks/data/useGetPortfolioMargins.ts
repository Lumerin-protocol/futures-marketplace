import { useReadContract } from "wagmi";
// Taken from the Futures ABI package rather than `collateral-margin-abi`: the
// pinned copy of the latter predates `computePortfolioMargins`, while this one
// is the interface `HashPowerFutures` itself calls it through.
import { IPortfolioMarginEngineAbi } from "futures-marketplace-abi/IPortfolioMarginEngine.ts";
import { useFuturesMarginEngine } from "./useFuturesMarginEngine";
import { withErrors } from "../../lib/withErrors";

type QueryKeyCarrier = { queryKey: readonly unknown[] };

/// Last successful margins, reused only when that read was for this account.
/// Wagmi's query key is `["readContract", { args }]`, and `args[0]` is the
/// account. A plain `keepPreviousData` would also reuse the pair across a
/// wallet switch, so the panel would show the previous account's margin and
/// the risk toast could fire on it. Missing or unreadable args fail closed:
/// the panel skeletons instead of showing someone else's numbers.
export function marginsForSameAccount<T>(
  previous: T | undefined,
  previousQuery: QueryKeyCarrier | undefined,
  address: string | undefined,
): T | undefined {
  if (previous === undefined || !address) return undefined;
  const params = previousQuery?.queryKey[1];
  const args =
    params && typeof params === "object" && "args" in params
      ? (params as { args?: readonly unknown[] }).args
      : undefined;
  const previousAddress = args?.[0];
  if (typeof previousAddress !== "string") return undefined;
  if (previousAddress.toLowerCase() !== address.toLowerCase()) return undefined;
  return previous;
}

/// Reads the user's portfolio Initial and Maintenance Margin from the
/// `IPortfolioMarginEngine` resolved via the Futures contract's immutable
/// `portfolioMargin` address. Both figures cover every open position and
/// resting order across the venues that share the collateral vault.
///
/// One call rather than `computePortfolioIM` plus `computePortfolioMM`: the
/// panel drives its capability flag off IM and its risk ladder off MM, and two
/// separately-polled reads could disagree about which price they were taken at
/// — enough to show a healthy ratio next to a restricted account.
export function useGetPortfolioMargins(address: `0x${string}` | undefined) {
  const { data: engine } = useFuturesMarginEngine();
  const result = useReadContract({
    address: engine,
    abi: withErrors(IPortfolioMarginEngineAbi),
    functionName: "computePortfolioMargins",
    args: address ? [address] : undefined,
    query: {
      enabled: !!engine && !!address,
      // TEMP: tightened while debugging the panel's refresh UX; restore to
      // backgroundRefetchOpts (15s) — this is a heavy view.
      refetchInterval: 5_000,
      // A poll of the same query key keeps its cached pair on its own. This
      // only matters when the key changes: reuse the pair if it was read for
      // this account (the engine address settling), and drop it on a wallet
      // switch so the panel skeletons instead of showing the other account.
      placeholderData: (previous, previousQuery) =>
        marginsForSameAccount(previous, previousQuery, address),
    },
  });

  const margins = result.data as readonly [bigint, bigint] | undefined;

  return {
    ...result,
    im: margins?.[0],
    mm: margins?.[1],
  };
}
