import { useReadContract } from "wagmi";
import { keepPreviousData } from "@tanstack/react-query";
import { IPortfolioMarginEngineAbi } from "collateral-margin-abi/IPortfolioMarginEngine.ts";
import { useFuturesMarginEngine } from "./useFuturesMarginEngine";
import { withErrors } from "../../lib/withErrors";

/// Reads the user's portfolio Initial Margin (IM) from the
/// `IPortfolioMarginEngine` contract resolved via the Futures contract's
/// immutable `marginEngine` address. This single value replaces the previous
/// per-engine aggregation of venue-local margin views and represents the total
/// collateral locked across open positions and resting orders.
export function useGetPortfolioIM(address: `0x${string}` | undefined) {
  const { data: engine } = useFuturesMarginEngine();
  const result = useReadContract({
    address: engine,
    abi: withErrors(IPortfolioMarginEngineAbi),
    functionName: "computePortfolioIM",
    args: address ? [address] : undefined,
    query: {
      enabled: !!engine && !!address,
      // TEMP: tighten poll while debugging Locked refresh UX; restore to
      // backgroundRefetchOpts (15s) — computePortfolioIM is a heavy view.
      refetchInterval: 5_000,
      // Keep the last Locked figure while a background poll is in flight (and
      // across brief query-key churn) so the balance widget does not blank out.
      placeholderData: keepPreviousData,
    },
  });

  return result;
}
