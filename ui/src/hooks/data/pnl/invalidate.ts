import type { QueryClient } from "@tanstack/react-query";
import { PORTFOLIO_REALIZED_PNL_QK } from "./usePortfolioRealizedPnl";
import { PORTFOLIO_OPEN_EXPOSURE_QK } from "./usePortfolioUnrealizedPnl";

/**
 * Drops the account's cached PnL reads. Call after any confirmed tx that changes
 * positions or fills, alongside the existing position/order invalidations.
 *
 * Without this the header keeps serving the pre-trade exposure snapshot until
 * the next background poll, and a stale snapshot does not merely lag: an empty
 * one prices to a flat `0` that no amount of mark movement can shift, so the
 * unrealized figure looks frozen rather than late.
 *
 * Both keys are invalidated by prefix, which covers every venue and every
 * window cutoff without the caller knowing about either.
 */
export async function invalidatePortfolioPnl(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [PORTFOLIO_OPEN_EXPOSURE_QK] }),
    queryClient.invalidateQueries({ queryKey: [PORTFOLIO_REALIZED_PNL_QK] }),
  ]);
}
