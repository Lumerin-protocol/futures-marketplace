/**
 * Account risk arithmetic for the portfolio panel.
 *
 * The engine's initial margin already carries the account's unrealized loss:
 * `IM(P) = stressLoss(shocked P) + fillLoss(P) + Σ max(0, -pnl_market(P))`, with
 * that last term evaluated at spot rather than at the shocked price. Showing IM
 * verbatim next to Unrealized PnL therefore counts the loss twice, which is what
 * made `Balance + uPnL < Locked` read as an accounting error. Subtracting the
 * loss term back out leaves the stress-and-fill requirement, and the panel adds
 * up again.
 *
 * The requirement is recomputed live rather than being a slice of balance set
 * aside, so `Available` is the vault's own withdrawal check and not a residual
 * of the other cells.
 */

import { PAYMENT_TOKEN_SCALE_NUM } from "./units";

/** On-chain reads the panel is derived from, all in payment-token units. */
export interface MarginInputs {
  /** `vault.balanceOf(user)`. */
  balance: bigint;
  im: bigint;
  mm: bigint;
  /** `Σ getRiskView(user).unrealizedPnl` over the engine's linear markets. */
  netUnrealizedPnl: bigint;
  /**
   * `Σ max(0, -unrealizedPnl)` over the same markets. Clamped per market and
   * never netted, because that is how the IM path aggregates it — a hedged book
   * pays for both legs' losses without either gain offsetting them.
   */
  unrealizedLossTerm: bigint;
  /** The engine's spot shocks, needed to split the requirements into stress and loss. */
  shocks: MarginShocks;
}

/** WAD-scaled spot shocks the engine stresses with; `imSpotShock > mmSpotShock`. */
export interface MarginShocks {
  imSpotShock: bigint;
  mmSpotShock: bigint;
}

export interface MarginFigures {
  /** Balance plus unrealized PnL across all venues. */
  equity: bigint;
  /** Initial margin with the double-counted unrealized loss removed. */
  marginUsed: bigint;
  /** Withdrawable and usable for new positions. */
  available: bigint;
  /** `marginRatioPercent`, or `null` when there is nothing to divide by. */
  ratioPercent: number | null;
  /**
   * Capability flag rather than a risk level: the vault blocks withdrawals and
   * new positions below IM, but liquidation is driven off MM.
   */
  belowIM: boolean;
}

export function deriveMarginFigures({
  balance,
  im,
  mm,
  netUnrealizedPnl,
  unrealizedLossTerm,
  shocks,
}: MarginInputs): MarginFigures {
  // The loss term is a component of IM, so this cannot go negative on a
  // consistent pair of reads. The two polls run on different cadences, though,
  // and a mid-flight skew should read as zero rather than as a negative
  // requirement.
  const marginUsed = im > unrealizedLossTerm ? im - unrealizedLossTerm : 0n;

  return {
    equity: balance + netUnrealizedPnl,
    marginUsed,
    available: balance > im ? balance - im : 0n,
    ratioPercent: marginRatioPercent(balance, im, mm, shocks),
    belowIM: balance < im,
  };
}

/**
 * The margin ratio: maintenance stress ÷ equity, in percent.
 *
 * The engine's two checks are `balance ≥ IM` and `balance ≥ MM`, where each
 * requirement is `stress(shock) + shared` and the shared part — fill loss,
 * unrealized loss, funding owed — is the same in both (mirrors `_computeMargin`).
 * A linear book's stress scales with the shock, so the checks are really
 * `balance − shared ≥ stress_S` and `≥ stress_s`: equity, with losses counted
 * and gains ignored exactly as the engine does, against a pure stress figure.
 *
 * This is the second check as a fraction. The stress is recovered from the two
 * reads as `(IM − MM) · s / (S − s)` and the shared part as `MM − stress_s`, so
 * no extra read is needed. Compared with the raw `MM / balance`, both ends are
 * pinned regardless of the account's losses: 100% exactly at liquidation
 * (`balance = MM`) and `s / S` exactly where balance meets IM. That makes the
 * tier boundaries constants of the deployment (`thresholdsFromShocks`) rather
 * than of the account.
 *
 * `null` with nothing to divide by (an empty account); `DISPLAY_RATIO_CAP` once
 * equity is at or below zero, which is well past liquidation.
 */
export function marginRatioPercent(
  balance: bigint,
  im: bigint,
  mm: bigint,
  { imSpotShock, mmSpotShock }: MarginShocks,
): number | null {
  const S = Number(imSpotShock);
  const s = Number(mmSpotShock);
  // Degenerate shocks cannot come from a live engine; treat the gap as the
  // stress itself rather than divide by zero.
  const scale = S > s && s > 0 ? s / (S - s) : 1;
  // IM ≥ MM on a consistent pair of reads; a mid-flight skew reads as no stress.
  const stress = im > mm ? Number(im - mm) * scale : 0;
  const equity = Number(balance - mm) + stress;
  if (equity <= 0) return stress > 0 ? DISPLAY_RATIO_CAP : null;
  return (stress / equity) * 100;
}

export type MarginTier = "healthy" | "caution" | "danger" | "liquidatable";

export interface MarginRatioThresholds {
  caution: number;
  danger: number;
}

/** The ratio at which the keeper can liquidate: `MM > balance`. */
export const LIQUIDATABLE_PERCENT = 100;

/** Past this the exact figure stops carrying information. */
export const DISPLAY_RATIO_CAP = 999;

/**
 * Where the tiers begin, as points of `marginRatioPercent`.
 *
 * The tiers are defined against the engine's own requirements: Caution once
 * balance is below IM (the vault is already refusing withdrawals and new
 * positions there), Danger once half of the cushion from IM down to MM is
 * spent. Because the ratio is stress-over-equity, both land on constants of
 * the shocks `S` (IM) and `s` (MM), whatever the account's losses:
 *
 *   balance = IM              ⇔  r = s / S
 *   balance = (IM + MM) / 2   ⇔  r = 2s / (S + s)
 *
 * Rounded to whole points, which is how the ratio is shown.
 */
export function thresholdsFromShocks({ imSpotShock, mmSpotShock }: MarginShocks): MarginRatioThresholds {
  const S = Number(imSpotShock);
  const s = Number(mmSpotShock);
  if (!(S > 0) || !(s > 0) || s >= S) return DEFAULT_MARGIN_RATIO_THRESHOLDS;
  return {
    caution: Math.round((s / S) * 100),
    danger: Math.round(((2 * s) / (S + s)) * 100),
  };
}

/** `thresholdsFromShocks` at the shocks the engine ships with (IM 10%, MM 5%); used until they are read. */
export const DEFAULT_MARGIN_RATIO_THRESHOLDS: MarginRatioThresholds = { caution: 50, danger: 67 };

/**
 * The tier for a ratio. A pure function of the current reading, with no memory
 * of the previous tier: each boundary is an engine fact (below IM, half-way to
 * MM, liquidatable), so the colour should say exactly where the account is now
 * and clear the moment it is no longer true.
 */
export function marginTier(
  ratioPercent: number | null,
  thresholds: MarginRatioThresholds = DEFAULT_MARGIN_RATIO_THRESHOLDS,
): MarginTier {
  // No balance to divide by, or no usable margin read: there is no ratio, so
  // there is no tier to be in.
  if (ratioPercent === null) return "healthy";
  if (ratioPercent >= LIQUIDATABLE_PERCENT) return "liquidatable";
  if (ratioPercent >= thresholds.danger) return "danger";
  if (ratioPercent >= thresholds.caution) return "caution";
  return "healthy";
}

export const RESTRICTED_STATUS_COPY =
  "Below initial margin. Withdrawals and new positions are disabled; reducing orders are allowed.";

export function formatMarginRatio(ratioPercent: number | null): string {
  if (ratioPercent === null) return "—";
  return `${Math.min(Math.round(ratioPercent), DISPLAY_RATIO_CAP)}%`;
}

export interface MarginStatusContext {
  ratioPercent: number | null;
  /** Account-wide level from `useLiquidationThresholds`, when it has solved. */
  liqPrice?: bigint;
}

/** Status line for the tier itself. The Restricted note stacks separately. */
export function marginStatusCopy(
  tier: MarginTier,
  { ratioPercent, liqPrice }: MarginStatusContext,
): string | null {
  switch (tier) {
    case "liquidatable":
      return "Account is liquidatable. Positions may be closed at any moment.";
    case "danger": {
      const action = "Liquidation risk. Deposit or reduce your position.";
      if (liqPrice === undefined) return action;
      return `${action} Liq. price ≈ ${(Number(liqPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)}.`;
    }
    case "caution":
      return `Margin ratio ${formatMarginRatio(ratioPercent)}. Liquidation at 100%.`;
    default:
      return null;
  }
}
