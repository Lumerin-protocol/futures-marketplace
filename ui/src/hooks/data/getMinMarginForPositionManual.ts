/// WAD scale used by the PortfolioMarginEngine shock parameters.
const WAD = 10n ** 18n;

/**
 * Approximate per-position maintenance for UI display.
 *
 * Margin is a cross-account figure owned by the PortfolioMarginEngine, so this
 * is only a per-leg preview: it applies the engine's MM spot shock to the entry
 * notional and subtracts mark PnL on that quantity, the same shape the engine
 * stresses a linear leg with. The real requirement nets every venue and can be
 * lower than the sum of these previews. Quantity is whole contracts (no
 * QUANTITY_DECIMALS scale).
 *
 * @param mmSpotShock Maintenance spot shock as a WAD fraction (1e18 = 100%).
 */
export function getMinMarginForPositionManual(
  entryPrice: bigint,
  qty: number,
  marketPrice: bigint,
  mmSpotShock: bigint,
) {
  const qtyBigInt = BigInt(Math.trunc(qty));
  const absQty = qtyBigInt < 0n ? -qtyBigInt : qtyBigInt;

  const pnl = (marketPrice - entryPrice) * qtyBigInt;
  const maintenanceMargin = (entryPrice * absQty * mmSpotShock) / WAD;

  return maintenanceMargin - pnl;
}
