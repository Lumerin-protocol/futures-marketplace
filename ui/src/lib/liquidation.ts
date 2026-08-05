import styled from "@mui/material/styles/styled";
import { tokens } from "../styles/tokens";
import type { LiquidationDirection } from "./portfolioMargin";
import { PAYMENT_TOKEN_SCALE_NUM } from "./units";

/**
 * Shared liquidation surfacing helpers for the Trades / Orders / Positions
 * tables across both products (perps + futures). A liquidation is modeled as a
 * forced `Trade` (`isLiquidation`) — these helpers render it red and describe
 * how much of the position was force-closed.
 *
 * Not unit-tested (manual verification only, per the liquidation-UI plan).
 */

/** Red background applied to a liquidated table row. */
export const LIQUIDATION_ROW_BG = tokens.trading.shortRowBg;

/** Small red chip flagging a liquidated row/order. Consumer supplies the label. */
export const LiquidationChip = styled("span")`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${tokens.trading.shortRowBg};
  color: ${tokens.status.error};
  white-space: nowrap;
`;

const ACCOUNT_WIDE_NOTE =
  "Account-wide and cross-product: one collateral pool backs every futures and perps position, so this is the same level in both modes.";

/**
 * Spells out the level from `pickLiquidationLevel` for the header stat and the
 * positions-table column. Returns a plain string, so it works equally in a MUI
 * `Tooltip` and a native `title` attribute.
 *
 * Wording is "can be liquidated" rather than "is liquidated": crossing the
 * level only makes `isLiquidatable` return true, the keeper still has to act.
 */
export function describeLiquidationLevel(opts: {
  price?: bigint;
  direction?: LiquidationDirection;
  isUnderwater?: boolean;
}): string {
  const { price, direction, isUnderwater } = opts;

  if (isUnderwater) {
    return `Balance is already below maintenance margin — the account can be liquidated on any tick. ${ACCOUNT_WIDE_NOTE}`;
  }
  if (price === undefined || direction === undefined) {
    return `No liquidation level while the account carries no exposure. ${ACCOUNT_WIDE_NOTE}`;
  }

  const formatted = (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  const move = direction === "down" ? "falls" : "rises";
  return `If the price ${move} to ${formatted} USDC, the account can be liquidated. ${ACCOUNT_WIDE_NOTE}`;
}

type Qty = bigint | number;

function absToNumber(q: Qty, scale: number): number {
  const abs = typeof q === "bigint" ? (q < 0n ? -q : q) : Math.abs(q);
  return Number(abs) / scale;
}

function trimTrailingZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * Fraction (0-100) of the position that was liquidated by this forced trade.
 * Scale-invariant, so the raw `tradeQuantity` / `netQuantityAfter` can be used
 * directly regardless of the product's decimals.
 */
export function liquidatedPercent(
  tradeQuantity: Qty,
  netQuantityAfter: Qty,
): number {
  const closed = absToNumber(tradeQuantity, 1);
  const remaining = absToNumber(netQuantityAfter, 1);
  const total = closed + remaining;
  return total > 0 ? (closed / total) * 100 : 0;
}

/**
 * Human label:
 *  - partial: `"Liquidated 3 / 8 (37.5%)"`, where `3` is the closed amount
 *    (abs(tradeQuantity)) and `8` is the position size before the close
 *    (closed + abs(netQuantityAfter)).
 *  - full: `"Liquidated (100%)"` — the `closed / total` pair is redundant when
 *    nothing remains, so it's dropped.
 *
 * - `scale`: divisor applied to the raw quantities (e.g. `PAYMENT_TOKEN_SCALE_NUM`
 *   for perps' fixed-point quantities; `1` for futures' integer contract counts).
 * - `fractionDigits`: decimals for the closed/total magnitudes (trailing zeros trimmed).
 */
export function formatLiquidatedQty(
  tradeQuantity: Qty,
  netQuantityAfter: Qty,
  opts: { scale?: number; fractionDigits?: number } = {},
): string {
  const scale = opts.scale ?? 1;
  const fractionDigits = opts.fractionDigits ?? 0;
  const closed = absToNumber(tradeQuantity, scale);
  const remaining = absToNumber(netQuantityAfter, scale);
  const total = closed + remaining;
  const pct = total > 0 ? (closed / total) * 100 : 0;
  const pctStr = trimTrailingZeros(pct.toFixed(1));
  if (remaining <= 0) return `Liquidated (${pctStr}%)`;
  const fmt = (n: number) => trimTrailingZeros(n.toFixed(fractionDigits));
  return `Liquidated ${fmt(closed)} / ${fmt(total)} (${pctStr}%)`;
}
