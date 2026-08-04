import { useMemo } from "react";
import {
  solveLiquidationThresholds,
  type LiquidationThresholds,
  type MarginParams,
} from "../../lib/portfolioMargin";
import { useGetMarketPrice } from "./useGetMarketPrice";
import { useMarginEngineShocks } from "./useMarginEngineShocks";
import { usePortfolioSnapshot } from "./usePortfolioSnapshot";

/// Account-wide liquidation prices: the spot levels at which the Futures
/// contract starts reporting `balance < computePortfolioMM(user)`.
///
/// Portfolio margin is cross-product, so this is one pair of thresholds per
/// account rather than one per position. `liqDown` and `liqUp` are both
/// possible because `MM(P)` is a tent — a hedged book can be liquidated by a
/// move in either direction, and a flat book by neither.
///
/// The engine reads the perps mark for stress and each product's own mark for
/// unrealized PnL. Both derive from the same hashrate oracle, so we solve on
/// the single price the rest of the UI already uses.
export function useLiquidationThresholds(address: `0x${string}` | undefined) {
  const { snapshot, tokenDecimals, perpQuantityDecimals, isLoading, isError } =
    usePortfolioSnapshot(address);
  const shocks = useMarginEngineShocks();
  const { data: marketPrice } = useGetMarketPrice();

  const params = useMemo<MarginParams | undefined>(() => {
    if (shocks.imSpotShock === undefined || shocks.mmSpotShock === undefined) return undefined;
    if (tokenDecimals === undefined || perpQuantityDecimals === undefined) return undefined;
    return {
      imSpotShock: shocks.imSpotShock,
      mmSpotShock: shocks.mmSpotShock,
      tokenDecimals,
      perpQuantityDecimals,
    };
  }, [shocks.imSpotShock, shocks.mmSpotShock, tokenDecimals, perpQuantityDecimals]);

  const thresholds = useMemo<LiquidationThresholds | undefined>(() => {
    if (!snapshot || !params || !marketPrice) return undefined;
    return solveLiquidationThresholds(snapshot, params, marketPrice as bigint);
  }, [snapshot, params, marketPrice]);

  return {
    liqDown: thresholds?.liqDown,
    liqUp: thresholds?.liqUp,
    alreadyUnderwater: thresholds?.alreadyUnderwater ?? false,
    snapshot,
    params,
    isLoading: isLoading || shocks.isLoading,
    isError: isError || shocks.isError,
  };
}
