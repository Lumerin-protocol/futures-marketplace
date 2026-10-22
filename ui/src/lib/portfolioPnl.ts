/**
 * Account-wide PnL math, shared by every venue the account trades on.
 *
 * Both numbers the portfolio header shows are cross-venue sums, so the per-venue
 * differences have to be data rather than branches: a leg carries its own mark
 * and its own quantity scale, and realized PnL is reduced to one subtraction
 * that reads the same against any subgraph. Adding a venue means producing more
 * legs, not touching this file.
 */

/** Trailing window the header's realized PnL covers. */
export const REALIZED_PNL_WINDOW_DAYS = 30;

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;

/**
 * Unix-seconds boundary of the realized-PnL window.
 *
 * Bucketed to the hour because this value is part of the react-query key for the
 * baseline lookup — a live `Date.now()` would mint a new key on every render and
 * refetch forever.
 */
export function windowCutoffSeconds(nowMs: number = Date.now()): number {
  const currentHour = Math.floor(nowMs / 1000 / HOUR_SECONDS) * HOUR_SECONDS;
  return currentHour - REALIZED_PNL_WINDOW_DAYS * DAY_SECONDS;
}

/** One piece of open exposure, already priced by its venue. */
export interface UnrealizedLeg {
  /** Signed: positive = long, negative = short. */
  netQuantity: bigint;
  entryPrice: bigint;
  /**
   * Price this leg is marked at. Usually the live mark, but a matured futures
   * expiration whose settlement price is pinned marks against that instead, so
   * its PnL stops drifting once the price is recorded.
   */
  markPrice: bigint;
  /**
   * On-chain quantity scale of the venue the leg came from: `1n` for indivisible
   * futures contracts, `QUANTITY_SCALE` for 6-decimal perps quantities.
   */
  quantityScale: bigint;
}

/**
 * `(mark - entry) * signedQty` per leg, summed. The sign of each leg's result
 * falls out of the signed quantity, so shorts need no special case.
 */
export function sumUnrealizedPnl(legs: UnrealizedLeg[]): bigint {
  let total = 0n;
  for (const leg of legs) {
    if (leg.netQuantity === 0n) continue;
    total += ((leg.markPrice - leg.entryPrice) * leg.netQuantity) / leg.quantityScale;
  }
  return total;
}

/**
 * Realized PnL accrued after `baseline` was taken.
 *
 * `Trade.cumulativeRealizedPnl` snapshots the account's lifetime realized PnL as
 * of that trade, so subtracting the snapshot carried by the newest trade *before*
 * the window leaves exactly what the window itself produced. A `null` baseline
 * means the account has no pre-window trades, and the lifetime total is already
 * the windowed one.
 */
export function realizedPnlSinceBaseline(
  lifetimeRealizedPnl: bigint,
  baseline: bigint | null,
): bigint {
  return lifetimeRealizedPnl - (baseline ?? 0n);
}

/** Hover text for every per-trade and per-position "Realized PnL" figure. */
export const REALIZED_PNL_FEES_HINT = "Net of trading and liquidation fees.";

/**
 * Realized PnL after the fees paid for it.
 *
 * Both indexers report `realizedPnl` as price PnL alone, `(exit − entry) ×
 * closed quantity`, and book each fee on a field of its own, while the contract
 * takes the fees out of the balance at every fill. A fee counts when it is paid,
 * so an opening fill realizes a loss of its fee. Fees are signed the way the
 * indexer signs them, positive when paid and negative for a rebate; `null` is a
 * fee that does not apply, such as `liquidationFee` on an ordinary trade.
 *
 * Perps funding is not netted: windowing it for the 30-day header would mean
 * paging every funding settlement in the window.
 */
export function realizedPnlAfterFees(realizedPnl: bigint, ...fees: (bigint | null)[]): bigint {
  let net = realizedPnl;
  for (const fee of fees) {
    if (fee !== null) net -= fee;
  }
  return net;
}

/**
 * Total fees across trade rows as the subgraph returns them, as decimal strings.
 * `tradingFee` may be left out of the selection, and `liquidationFee` is null
 * except on a forced close.
 */
export function sumTradeFees(
  trades: readonly { tradingFee?: string; liquidationFee?: string | null }[],
): bigint {
  let total = 0n;
  for (const trade of trades) {
    if (trade.tradingFee != null) total += BigInt(trade.tradingFee);
    if (trade.liquidationFee != null) total += BigInt(trade.liquidationFee);
  }
  return total;
}
