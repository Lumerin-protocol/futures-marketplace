import { PAYMENT_TOKEN_SCALE_NUM } from "./units";

/** Paid. U+2212, so it stays distinct from a hyphen in the column label. */
const PAID = "−";

/**
 * One fee, in USDC.
 *
 * The indexers sign a fee positive when the account paid it and negative for a
 * rebate. The column uses the opposite marks: − paid, + received. Zero has no
 * sign.
 */
export function formatFeeAmount(raw: bigint): string {
  if (raw === 0n) return "0.00";
  const paid = raw > 0n;
  const abs = Number(paid ? raw : -raw) / PAYMENT_TOKEN_SCALE_NUM;
  return `${paid ? PAID : "+"}${abs.toFixed(2)}`;
}

/**
 * Settled funding, in USDC, with the same marks as {@link formatFeeAmount}.
 *
 * The perps indexer signs funding the other way from fees: positive when the
 * account received it.
 */
export function formatFundingAmount(raw: bigint): string {
  return formatFeeAmount(-raw);
}

/** Funding, then trading fee, as `funding / trading`. */
export function formatFundingAndTradingFees(fundingFees: bigint, tradingFees: bigint): string {
  return `${formatFundingAmount(fundingFees)} / ${formatFeeAmount(tradingFees)}`;
}
