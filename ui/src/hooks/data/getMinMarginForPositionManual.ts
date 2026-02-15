export function getMinMarginForPositionManual(
  entryPricePerDay: bigint,
  qty: number,
  marketPricePerDay: bigint,
  marginPercent: number,
  deliveryDurationDays: number,
) {
  // Convert quantity to integer with 6 decimals precision for calculations
  // This ensures decimal quantities (e.g., 0.000001) are handled correctly
  const qtyWithDecimals = Math.round(qty * 1e6);
  const qtyBigInt = BigInt(qtyWithDecimals);
  const absQtyBigInt = qtyBigInt < 0n ? -qtyBigInt : qtyBigInt;
  
  // Calculate PnL: (marketPrice - entryPrice) * deliveryDays * qty
  // Divide by 1e6 to adjust for the quantity scaling
  const pnl = ((marketPricePerDay - entryPricePerDay) * BigInt(deliveryDurationDays) * qtyBigInt) / 1000000n;
  
  // Calculate maintenance margin: entryPrice * deliveryDays * |qty| * marginPercent / 100
  // Divide by 1e6 to adjust for the quantity scaling
  const maintenanceMargin =
    (entryPricePerDay * BigInt(deliveryDurationDays) * absQtyBigInt * BigInt(marginPercent)) / 100n / 1000000n;
  const effectiveMargin = maintenanceMargin - pnl;

  return effectiveMargin;
}
