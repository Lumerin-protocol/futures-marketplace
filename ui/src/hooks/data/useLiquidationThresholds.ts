import { useMemo } from "react";
import {
  pickLiquidationLevel,
  solveLiquidationThresholds,
  type LiquidationLevel,
  type MarginParams,
} from "../../lib/portfolioMargin";
import { useGetMarketPrice } from "./useGetMarketPrice";
import { useMarginEngineShocks } from "./useMarginEngineShocks";
import { usePortfolioSnapshot } from "./usePortfolioSnapshot";

/// The account's liquidation price: the spot level at which the Futures
/// contract starts reporting `balance < computePortfolioMM(user)`.
///
/// Cross-product and account-wide — futures and perps share one collateral
/// pool, so this is a single number for the whole book rather than one per
/// position, and it is the same in both contract modes.
///
/// `MM(P)` is a tent, so the solver finds a threshold on each side; which one
/// is surfaced is decided by `pickLiquidationLevel` off the net exposure.
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

  const level = useMemo<
    { level: LiquidationLevel | undefined; alreadyUnderwater: boolean } | undefined
  >(() => {
    if (!snapshot || !params || !marketPrice) return undefined;
    const price = marketPrice as bigint;
    const thresholds = solveLiquidationThresholds(snapshot, params, price);
    return {
      level: pickLiquidationLevel(snapshot, params, thresholds, price),
      alreadyUnderwater: thresholds.alreadyUnderwater,
    };
  }, [snapshot, params, marketPrice]);

  return {
    liqPrice: level?.level?.price,
    liqDirection: level?.level?.direction,
    alreadyUnderwater: level?.alreadyUnderwater ?? false,
    snapshot,
    params,
    isLoading: isLoading || shocks.isLoading,
    isError: isError || shocks.isError,
  };
}
