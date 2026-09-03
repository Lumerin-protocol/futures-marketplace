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
}

export interface MarginFigures {
  /** Balance plus unrealized PnL across all venues. */
  equity: bigint;
  /** Initial margin with the double-counted unrealized loss removed. */
  marginUsed: bigint;
  /** Withdrawable and usable for new positions. */
  available: bigint;
  /** `MM / balance * 100`, or `null` when there is no balance to divide by. */
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
    ratioPercent: balance === 0n ? null : (Number(mm) / Number(balance)) * 100,
    belowIM: balance < im,
  };
}

export type MarginTier = "healthy" | "caution" | "danger" | "liquidatable";

export interface MarginRatioThresholds {
  caution: number;
  danger: number;
}

/**
 * How far the ratio has to fall back below a tier's entry point before the tier
 * clears. Without it a ratio sitting on a boundary would toggle the border and
 * the banner on every poll.
 */
export const HYSTERESIS_POINTS = 5;

/** The ratio at which the keeper can liquidate: `MM > balance`. */
export const LIQUIDATABLE_PERCENT = 100;

/** Past this the exact figure stops carrying information. */
export const DISPLAY_RATIO_CAP = 999;

export const MARGIN_RATIO_THRESHOLDS: MarginRatioThresholds = {
  caution: Number(process.env.REACT_APP_MARGIN_RATIO_CAUTION_PERCENT || 60),
  danger: Number(process.env.REACT_APP_MARGIN_RATIO_DANGER_PERCENT || 80),
};

const TIER_ORDER = ["healthy", "caution", "danger", "liquidatable"] as const;

const rank = (tier: MarginTier): number => TIER_ORDER.indexOf(tier);

/** The tier the ratio reaches on its own, ignoring where the account came from. */
function tierAtEntry(ratioPercent: number, thresholds: MarginRatioThresholds): MarginTier {
  if (ratioPercent >= LIQUIDATABLE_PERCENT) return "liquidatable";
  if (ratioPercent >= thresholds.danger) return "danger";
  if (ratioPercent >= thresholds.caution) return "caution";
  return "healthy";
}

function exitPercent(tier: MarginTier, thresholds: MarginRatioThresholds): number {
  switch (tier) {
    // Being liquidatable is an on-chain fact, not a warning level. Holding the
    // banner past the boundary would tell the user their positions can be
    // closed at any moment when they no longer can.
    case "liquidatable":
      return LIQUIDATABLE_PERCENT;
    case "danger":
      return thresholds.danger - HYSTERESIS_POINTS;
    case "caution":
      return thresholds.caution - HYSTERESIS_POINTS;
    default:
      return Number.NEGATIVE_INFINITY;
  }
}

/**
 * The tier to show next, given the one currently on screen.
 *
 * Escalation is immediate — a jump straight from healthy to danger must not be
 * throttled — while de-escalation walks down one tier at a time and only once
 * the ratio has cleared each tier's exit threshold.
 */
export function nextTier(
  previous: MarginTier,
  ratioPercent: number | null,
  thresholds: MarginRatioThresholds = MARGIN_RATIO_THRESHOLDS,
): MarginTier {
  // No balance to divide by, or no usable margin read: there is no ratio, so
  // there is no tier to be in.
  if (ratioPercent === null) return "healthy";

  const reached = tierAtEntry(ratioPercent, thresholds);
  if (rank(reached) >= rank(previous)) return reached;

  let tier = previous;
  while (rank(tier) > rank(reached) && ratioPercent < exitPercent(tier, thresholds)) {
    tier = TIER_ORDER[rank(tier) - 1];
  }
  return tier;
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
