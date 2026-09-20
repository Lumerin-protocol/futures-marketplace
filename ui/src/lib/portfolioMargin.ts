/**
 * UI presentation layer over `@hashpower/portfolio-margin`.
 *
 * The margin model itself — the replica of `PortfolioMarginEngine._computeMargin`
 * and the threshold solver — lives in that shared package, which the keeper runs
 * too. It used to be duplicated here, and the copies drifted: they clamped
 * unrealized PnL differently, so the UI and the keeper disagreed about who was
 * liquidatable. Only the "which number do we show the user" decision belongs here.
 */

import {
  mmSurplus,
  netDeltaWad,
  solveLiquidationThresholds as solveThresholds,
  type AccountSnapshot,
  type MMParams,
} from "@hashpower/portfolio-margin";

export type LiquidationDirection = "down" | "up";

/** The one threshold surfaced to the user, plus which way price has to move. */
export interface LiquidationLevel {
  price: bigint;
  direction: LiquidationDirection;
}

export interface LiquidationThresholds {
  /** Liquidatable once spot falls to or below this. */
  liqDown?: bigint;
  /** Liquidatable once spot rises to or above this. */
  liqUp?: bigint;
  /** Balance is already under MM at the current price. */
  alreadyUnderwater: boolean;
}

/**
 * Prices on either side of `currentPrice` where the MM surplus crosses zero.
 *
 * Reports no thresholds when the account is already under MM — the keeper
 * liquidates immediately in that case rather than waiting for a price tick, so
 * there is nothing forward-looking to show.
 */
export function solveLiquidationThresholds(
  snap: AccountSnapshot,
  params: MMParams,
  currentPrice: bigint,
): LiquidationThresholds {
  if (currentPrice <= 0n) return { alreadyUnderwater: false };
  if (mmSurplus(snap, params, currentPrice) < 0n) return { alreadyUnderwater: true };

  const { liqDown, liqUp } = solveThresholds(snap, params, currentPrice);
  return { liqDown, liqUp, alreadyUnderwater: false };
}

/**
 * The single threshold to present as "the" liquidation price.
 *
 * Net exposure picks the side: a net long is hurt by a fall, a net short by a
 * rise. That is how a liquidation price reads on every other venue, and it
 * keeps us from leading with the stress-driven level on the profitable side.
 *
 * Two cases need care, and in both we fall back rather than report no risk:
 * - A delta-neutral book still has thresholds. `netDelta == 0` makes the perp
 *   and futures PnL slopes cancel, but resting orders are stressed per side and
 *   fill losses are clamped independently, so the requirement still moves with
 *   price. With no directional bias, take whichever level is nearer the mark.
 * - The preferred side may simply not exist. An over-collateralised long can
 *   survive all the way to `P = 0` and still breach the stress charge on the
 *   way up, so the only real threshold is the one against the position.
 */
export function pickLiquidationLevel(
  snap: AccountSnapshot,
  params: MMParams,
  thresholds: LiquidationThresholds,
  currentPrice: bigint,
): LiquidationLevel | undefined {
  const down: LiquidationLevel | undefined =
    thresholds.liqDown !== undefined
      ? { price: thresholds.liqDown, direction: "down" }
      : undefined;
  const up: LiquidationLevel | undefined =
    thresholds.liqUp !== undefined ? { price: thresholds.liqUp, direction: "up" } : undefined;

  if (down === undefined) return up;
  if (up === undefined) return down;

  const netDelta = netDeltaWad(snap, params);
  if (netDelta > 0n) return down;
  if (netDelta < 0n) return up;
  return currentPrice - down.price <= up.price - currentPrice ? down : up;
}
