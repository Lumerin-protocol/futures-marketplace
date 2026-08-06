import { useReadContract } from "wagmi";
import { IPortfolioMarginEngineAbi } from "collateral-margin-abi/IPortfolioMarginEngine.ts";
import { useFuturesMarginEngine } from "../useFuturesMarginEngine";

/**
 * Initial Margin the user's resting orders add on top of their positions, read from
 * `PortfolioMarginEngine.orderMarginOf`.
 *
 * Portfolio-wide, not per-venue, and no longer available from the perps contract at
 * all. The engine nets each market's per-side order delta into one portfolio net delta
 * and stresses the "all bids fill" and "all asks fill" legs, keeping the worse — so an
 * order's cost depends on the rest of the account, and a resting order that only moves
 * the portfolio toward flat costs nothing. There is no venue-local figure left to ask
 * for, and summing per-venue numbers would both double-count the stress and miss the
 * netting.
 *
 * The engine address is resolved from the Futures contract's `portfolioMargin`, the
 * same source `useGetPortfolioIM` uses.
 */
export function useGetPerpsOrderMargin(address: `0x${string}` | undefined) {
  const { data: engine } = useFuturesMarginEngine();
  return useReadContract({
    address: engine,
    abi: IPortfolioMarginEngineAbi,
    functionName: "orderMarginOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!engine && !!address,
      refetchInterval: 10000,
    },
  });
}
