import { QUANTITY_SCALE, QUANTITY_SCALE_NUM } from "../../lib/units";

export function getMinMarginForPositionManual(
  entryPricePerDay: bigint,
  qty: number,
  marketPricePerDay: bigint,
  marginPercent: number,
  deliveryDurationDays: number,
) {
  // Convert quantity to integer with QUANTITY_DECIMALS precision for calculations
  // This ensures decimal quantities (e.g., 0.000001) are handled correctly
  const qtyWithDecimals = Math.round(qty * QUANTITY_SCALE_NUM);
  const qtyBigInt = BigInt(qtyWithDecimals);
  const absQtyBigInt = qtyBigInt < 0n ? -qtyBigInt : qtyBigInt;

  // Calculate PnL: (marketPrice - entryPrice) * deliveryDays * qty
  // Divide by QUANTITY_SCALE to adjust for the quantity scaling
  const pnl = ((marketPricePerDay - entryPricePerDay) * BigInt(deliveryDurationDays) * qtyBigInt) / QUANTITY_SCALE;

  // Calculate maintenance margin: entryPrice * deliveryDays * |qty| * marginPercent / 100
  // Divide by QUANTITY_SCALE to adjust for the quantity scaling
  const maintenanceMargin =
    (entryPricePerDay * BigInt(deliveryDurationDays) * absQtyBigInt * BigInt(marginPercent)) / 100n / QUANTITY_SCALE;
  const effectiveMargin = maintenanceMargin - pnl;

  return effectiveMargin;
}
