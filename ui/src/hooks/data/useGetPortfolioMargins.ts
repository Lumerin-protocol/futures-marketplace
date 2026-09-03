import { useReadContract } from "wagmi";
import { keepPreviousData } from "@tanstack/react-query";
// Taken from the Futures ABI package rather than `collateral-margin-abi`: the
// pinned copy of the latter predates `computePortfolioMargins`, while this one
// is the interface `HashPowerFutures` itself calls it through.
import { IPortfolioMarginEngineAbi } from "futures-marketplace-abi/IPortfolioMarginEngine.ts";
import { useFuturesMarginEngine } from "./useFuturesMarginEngine";
import { withErrors } from "../../lib/withErrors";

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
      // Keep the last pair on screen while a background poll is in flight (and
      // across brief query-key churn) so the panel does not blank out.
      placeholderData: keepPreviousData,
    },
  });

  const margins = result.data as readonly [bigint, bigint] | undefined;

  return {
    ...result,
    im: margins?.[0],
    mm: margins?.[1],
  };
}
