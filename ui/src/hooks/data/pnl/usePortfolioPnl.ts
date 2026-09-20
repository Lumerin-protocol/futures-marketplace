import type { VenuePnlAggregate } from "./aggregate";
import { usePortfolioRealizedPnl } from "./usePortfolioRealizedPnl";
import { usePortfolioUnrealizedPnl } from "./usePortfolioUnrealizedPnl";

export interface PortfolioPnl {
  /** Mark-to-market on open positions across every venue. */
  unrealized: VenuePnlAggregate;
  /** Realized over the trailing `REALIZED_PNL_WINDOW_DAYS`, across every venue. */
  realizedInWindow: VenuePnlAggregate;
}

/**
 * The account's PnL, whichever venue produced it.
 *
 * Both figures are collateral-wide because the venues settle against the same
 * CollateralVault, so the header has no business tracking which trading tab is
 * open. Callers get the per-venue breakdown too, for anything that does want to
 * attribute a figure to a product.
 */
export function usePortfolioPnl(address: `0x${string}` | undefined): PortfolioPnl {
  return {
    unrealized: usePortfolioUnrealizedPnl(address),
    realizedInWindow: usePortfolioRealizedPnl(address),
  };
}
