// ── Liquidation price computation (pure) ────────────────────────────────────

/**
 * Compute the oracle price at which a user becomes liquidatable.
 *
 * Derivation from the contract's liquidation predicate:
 *
 *   liquidatable when:  balance < orderMargin + positionMaintenance(P)
 *
 *   positionMaintenance(P) = P * |q| / D * mPct/100 + max(0, -(P-e)*q/D)
 *
 * Solving for P:
 *   Long  (q > 0):  P_liq = (e*q - available*D) * 100 / (q * (100 - mPct))
 *   Short (q < 0):  P_liq = (e*Q + available*D) * 100 / (Q * (100 + mPct))
 *
 * where available = balance - orderMargin, Q = |q|
 *
 * `orderMargin` should come from `PortfolioMarginEngine.orderMarginOf` (see
 * `useGetPerpsOrderMargin`). Two caveats, and the second is new:
 *
 *   - Single-venue: for an account that also holds futures or options, the engine nets
 *     delta across legs and the true liquidation price is more forgiving than this.
 *   - Not price-independent. The engine stresses resting-order delta as part of
 *     portfolio net delta and charges each side's instant fill loss, both of which move
 *     with the oracle price, so `orderMargin` measured at today's mark is only a local
 *     approximation. Treating it as a constant makes this estimate drift as the price
 *     moves away from where it was read — fine for a displayed figure that refetches on
 *     an interval, wrong as the basis for anything that must be exact.
 */
export function computeLiquidationPrice(
  netQuantity: bigint,
  entryPrice: bigint,
  collateral: bigint,
  orderMargin: bigint,
  maintenanceMarginPercent: bigint,
  quantityDecimals: bigint,
): bigint {
  if (netQuantity === 0n) return 0n;

  const available = collateral > orderMargin ? collateral - orderMargin : 0n;

  const D = 10n ** quantityDecimals;

  if (netQuantity > 0n) {
    // Long: liquidatable when price drops BELOW this value
    const numerator = (entryPrice * netQuantity - available * D) * 100n;
    const denominator = netQuantity * (100n - maintenanceMarginPercent);
    if (denominator <= 0n) return 0n;
    return numerator / denominator;
  }

  // Short: liquidatable when price rises ABOVE this value
  const Q = -netQuantity;
  const numerator = (entryPrice * Q + available * D) * 100n;
  const denominator = Q * (100n + maintenanceMarginPercent);
  if (denominator <= 0n) return 0n;
  return numerator / denominator;
}
