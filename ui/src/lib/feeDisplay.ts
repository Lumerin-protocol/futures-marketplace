import { PAYMENT_TOKEN_SCALE_NUM } from "./units";

/** Paid. U+2212, so it stays distinct from a hyphen in the column label. */
const PAID = "−";

/**
 * One fee half, in USDC.
 *
 * The indexers sign a fee positive when the account paid it and negative for a
 * rebate. The column uses the opposite marks: − paid, + received. Zero has no
 * sign. Funding and trading fees share this convention.
 */
export function formatFeeAmount(raw: bigint): string {
  if (raw === 0n) return "0.00";
  const paid = raw > 0n;
  const abs = Number(paid ? raw : -raw) / PAYMENT_TOKEN_SCALE_NUM;
  return `${paid ? PAID : "+"}${abs.toFixed(2)}`;
}

/** Funding fee, then trading fee, each with {@link formatFeeAmount}. */
export function formatFundingAndTradingFees(fundingFees: bigint, tradingFees: bigint): string {
  return `${formatFeeAmount(fundingFees)} / ${formatFeeAmount(tradingFees)}`;
}
