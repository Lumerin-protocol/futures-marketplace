/**
 * Approximate per-order maintenance for UI display (Futures 3.0).
 * Mirrors on-chain order margin: maintenance = price × |qty| × marginPct / 100,
 * then subtract mark PnL on that resting qty. Quantity is whole contracts (no
 * QUANTITY_DECIMALS scale).
 */
export function getMinMarginForPositionManual(
  entryPrice: bigint,
  qty: number,
  marketPrice: bigint,
  marginPercent: number,
) {
  const qtyBigInt = BigInt(Math.trunc(qty));
  const absQty = qtyBigInt < 0n ? -qtyBigInt : qtyBigInt;

  const pnl = (marketPrice - entryPrice) * qtyBigInt;
  const maintenanceMargin = (entryPrice * absQty * BigInt(marginPercent)) / 100n;

  return maintenanceMargin - pnl;
}
