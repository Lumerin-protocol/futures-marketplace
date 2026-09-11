/**
 * How a 0–100% amount slider maps onto placeable quantities. Shared by the
 * order widget and the order modals so the thumb behaves the same everywhere.
 *
 * Quantities are display units: whole contracts for futures (0 decimals),
 * six-decimal fractions for perps.
 */

/** Largest placeable quantity not above `qty`. */
export function snapQuantityDown(qty: number, decimals: number): number {
  if (decimals === 0) return Math.floor(qty);
  const scale = 10 ** decimals;
  // The epsilon absorbs float noise such as 0.3 * 1e6 = 299999.99999999994.
  return Math.floor(qty * scale + 1e-6) / scale;
}

/**
 * The quantity a thumb position stands for. Interior positions round to the
 * nearest placeable quantity so the thumb feels balanced; only the ceiling is
 * floored, since that is a real limit.
 */
export function quantityAtPercent(pct: number, maxQty: number, decimals: number): number {
  const raw = (maxQty * pct) / 100;
  const scale = 10 ** decimals;
  const nearest = Math.round(raw * scale) / scale;
  return Math.min(nearest, snapQuantityDown(maxQty, decimals));
}

/** Where `qty` sits on the 0–100 track, rounded to a whole percent. */
export function percentForQuantity(qty: number, maxQty: number): number {
  return maxQty > 0 ? Math.round(Math.min(100, Math.max(0, (qty / maxQty) * 100))) : 0;
}
