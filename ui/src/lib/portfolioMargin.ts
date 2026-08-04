/**
 * Off-chain replica of `PortfolioMarginEngine._computeMargin` and the keeper's
 * liquidation-threshold solver, so the UI shows the price at which the account
 * actually becomes liquidatable on chain:
 *
 *   liquidatable when  vault.balanceOf(user) < computePortfolioMM(user)
 *
 * The engine's stress model is a 4-scenario (±spot, ±vol) grid. Our portfolios
 * are pure delta (no options), so gamma and vega drop out and the worst
 * scenario is always the spot move that opposes `netDelta`:
 *
 *   netDeltaWad = perpNetQty * WAD / 10^perpQuantityDecimals + Σ liveNetQuantity * WAD
 *   deltaS      = spotShock * P_wad / WAD
 *   stress      = fromWad(|netDeltaWad| * deltaS / WAD)
 *
 *   margin(P) = stress
 *             + perp.orderMargin + futures.orderMargin     (constant in P)
 *             + max(0, -perpUnrealizedPnl(P))
 *             + max(0, -futuresUnrealizedPnl(P))
 *             + perp.fundingOwed                           (constant in P)
 *
 * `margin(P)` is piecewise-linear with kinks at the perp break-even and the
 * aggregate futures break-even, so `balance - margin(P)` is a tent: there can
 * be a threshold below the mark, above it, both, or neither. We enumerate the
 * kinks and bisect within each monotone interval rather than solving a closed
 * form, matching `keeper/src/predict/solve.ts`.
 *
 * Two things to know about the fidelity of this replica:
 *
 * - Both `orderMargin` values are frozen at the price they were read at. The
 *   contract recomputes them off `getMarketPrice()` on every call, so accounts
 *   with resting orders get an approximate threshold. Same limitation as the
 *   keeper.
 * - The futures unrealized loss is clamped on the *aggregate* PnL, mirroring
 *   `max(0, -futures.getUnrealizedPnl(user))` in the engine. The keeper clamps
 *   per expiry, which is strictly more conservative; we follow the engine
 *   because that is what gates `NotLiquidatable`.
 *
 * All arithmetic is bigint with the same truncation order as the Solidity, so
 * `marginRequired(snap, params, markPrice, false)` reproduces
 * `computePortfolioMM` exactly.
 */

const WAD = 10n ** 18n;

/** One `(user, expirationAt)` aggregate from `Futures.getUserPosition`. */
export interface FuturesAggregate {
  expirationAt: bigint;
  /** Signed whole contracts, positive long / negative short. */
  netQuantity: bigint;
  /** Token decimals; `Σ fillPrice × signedFillQty`. */
  netEntryValue: bigint;
  /** `Futures.settlementPrice(expirationAt)`; `0` while the expiry is live. */
  settlementPrice: bigint;
}

/** Everything needed to evaluate `margin(P)` at an arbitrary price. */
export interface PortfolioSnapshot {
  /** Vault balance in token decimals. */
  balance: bigint;
  perp: {
    /** Signed, scaled by `10^perpQuantityDecimals`. */
    netQty: bigint;
    entryPrice: bigint;
    orderMargin: bigint;
    /** `max(0, getPendingFunding(user))` — only what the user owes. */
    fundingOwed: bigint;
  };
  futures: {
    orderMargin: bigint;
    positions: FuturesAggregate[];
  };
}

/** Engine-wide constants; they only move on a PME admin transaction. */
export interface MarginParams {
  /** WAD fraction, e.g. `0.1e18` = 10%. */
  imSpotShock: bigint;
  /** WAD fraction, e.g. `0.05e18` = 5%. */
  mmSpotShock: bigint;
  /** Collateral token decimals (USDC = 6). */
  tokenDecimals: number;
  /** Perps `QUANTITY_DECIMALS` (typically 6). */
  perpQuantityDecimals: number;
}

export interface LiquidationThresholds {
  /** Liquidatable once spot falls to or below this. */
  liqDown?: bigint;
  /** Liquidatable once spot rises to or above this. */
  liqUp?: bigint;
  /** Balance is already under MM at the current price. */
  alreadyUnderwater: boolean;
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

/** `10^(18 - tokenDecimals)`: WAD ↔ token-decimal scale, matching `_wadScale`. */
function wadScale(tokenDecimals: number): bigint {
  return 10n ** BigInt(18 - tokenDecimals);
}

/**
 * Net linear delta in WAD, matching `_aggregateGreeks`. Settled expiries are
 * excluded because `Futures.getNetPositionDelta` skips any date with a
 * recorded settlement price.
 */
export function netDeltaWad(snap: PortfolioSnapshot, params: MarginParams): bigint {
  const perpQtyScale = 10n ** BigInt(params.perpQuantityDecimals);
  let delta = (snap.perp.netQty * WAD) / perpQtyScale;
  for (const pos of snap.futures.positions) {
    if (pos.settlementPrice !== 0n) continue;
    delta += pos.netQuantity * WAD;
  }
  return delta;
}

/**
 * Worst-case stress loss in token decimals. With gamma and vega at zero the
 * four scenarios collapse to the spot move opposing `netDelta`.
 */
export function stressLoss(
  netDelta: bigint,
  spotShock: bigint,
  price: bigint,
  tokenDecimals: number,
): bigint {
  if (netDelta === 0n) return 0n;
  const scale = wadScale(tokenDecimals);
  const priceWad = price * scale;
  const deltaS = (spotShock * priceWad) / WAD;
  const lossWad = (abs(netDelta) * deltaS) / WAD;
  return lossWad / scale;
}

/** `(P - entry) × netQty / 10^perpQuantityDecimals`. */
export function perpUnrealizedPnl(
  snap: PortfolioSnapshot,
  params: MarginParams,
  price: bigint,
): bigint {
  if (snap.perp.netQty === 0n) return 0n;
  const perpQtyScale = 10n ** BigInt(params.perpQuantityDecimals);
  return ((price - snap.perp.entryPrice) * snap.perp.netQty) / perpQtyScale;
}

/**
 * Aggregate futures PnL, matching `Futures.getUnrealizedPnl`: a settled expiry
 * marks at its recorded settlement price and is therefore constant in `P`.
 */
export function futuresUnrealizedPnl(snap: PortfolioSnapshot, price: bigint): bigint {
  let pnl = 0n;
  for (const pos of snap.futures.positions) {
    const mark = pos.settlementPrice !== 0n ? pos.settlementPrice : price;
    pnl += mark * pos.netQuantity - pos.netEntryValue;
  }
  return pnl;
}

/** `computePortfolioMM` (isIM `false`) / `computePortfolioIM` (isIM `true`) at price `P`. */
export function marginRequired(
  snap: PortfolioSnapshot,
  params: MarginParams,
  price: bigint,
  isIM: boolean,
): bigint {
  const spotShock = isIM ? params.imSpotShock : params.mmSpotShock;
  const stress = stressLoss(netDeltaWad(snap, params), spotShock, price, params.tokenDecimals);

  const perpPnl = perpUnrealizedPnl(snap, params, price);
  const futPnl = futuresUnrealizedPnl(snap, price);

  return (
    stress +
    snap.perp.orderMargin +
    snap.futures.orderMargin +
    (perpPnl < 0n ? -perpPnl : 0n) +
    (futPnl < 0n ? -futPnl : 0n) +
    snap.perp.fundingOwed
  );
}

/** `balance - MM(P)`. Negative means liquidatable. */
export function mmSurplus(
  snap: PortfolioSnapshot,
  params: MarginParams,
  price: bigint,
): bigint {
  return snap.balance - marginRequired(snap, params, price, false);
}

/** `balance - IM(P)`. Negative means below the initial-margin buffer. */
export function imSurplus(
  snap: PortfolioSnapshot,
  params: MarginParams,
  price: bigint,
): bigint {
  return snap.balance - marginRequired(snap, params, price, true);
}

/**
 * Prices on either side of `currentPrice` where `mmSurplus` crosses zero.
 *
 * Returns no thresholds when the account is already under MM — the keeper
 * liquidates immediately in that case rather than waiting for a price tick,
 * so there is nothing forward-looking to show.
 */
export function solveLiquidationThresholds(
  snap: PortfolioSnapshot,
  params: MarginParams,
  currentPrice: bigint,
): LiquidationThresholds {
  if (currentPrice <= 0n) return { alreadyUnderwater: false };
  if (mmSurplus(snap, params, currentPrice) < 0n) return { alreadyUnderwater: true };

  const { down, up } = findClosestCrossings(snap, currentPrice, (p) =>
    mmSurplus(snap, params, p),
  );
  return { liqDown: down, liqUp: up, alreadyUnderwater: false };
}

/** Break-even of a single aggregate, `|netEntryValue| / |netQuantity|`. */
function aggregateBreakEven(pos: FuturesAggregate): bigint | undefined {
  const absQty = abs(pos.netQuantity);
  if (absQty === 0n) return undefined;
  return abs(pos.netEntryValue) / absQty;
}

/**
 * Price at which the *aggregate* futures PnL flips sign. This is the real kink
 * of `margin(P)` under the engine's aggregate clamp:
 *
 *   futPnl(P) = P × Q_live − V_live + C_settled = 0
 */
function futuresAggregateBreakEven(snap: PortfolioSnapshot): bigint | undefined {
  let liveQty = 0n;
  let liveEntryValue = 0n;
  let settledPnl = 0n;
  for (const pos of snap.futures.positions) {
    if (pos.settlementPrice !== 0n) {
      settledPnl += pos.settlementPrice * pos.netQuantity - pos.netEntryValue;
      continue;
    }
    liveQty += pos.netQuantity;
    liveEntryValue += pos.netEntryValue;
  }
  if (liveQty === 0n) return undefined;
  const breakEven = (liveEntryValue - settledPnl) / liveQty;
  return breakEven > 0n ? breakEven : undefined;
}

/**
 * Closest prices on either side of `currentPrice` where `f` crosses zero.
 * `f` is piecewise-linear with kinks only at the leg break-evens, so it is
 * monotone inside every interval bounded by adjacent kinks and a plain
 * bisection converges there.
 */
function findClosestCrossings(
  snap: PortfolioSnapshot,
  currentPrice: bigint,
  f: (price: bigint) => bigint,
): { down?: bigint; up?: bigint } {
  const kinks: bigint[] = [];
  if (snap.perp.netQty !== 0n) kinks.push(snap.perp.entryPrice);
  for (const pos of snap.futures.positions) {
    if (pos.settlementPrice !== 0n) continue;
    const breakEven = aggregateBreakEven(pos);
    if (breakEven !== undefined && breakEven > 0n) kinks.push(breakEven);
  }
  const aggregate = futuresAggregateBreakEven(snap);
  if (aggregate !== undefined) kinks.push(aggregate);
  kinks.push(currentPrice);
  kinks.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const bounds: bigint[] = [];
  for (const k of kinks) {
    if (bounds.length === 0 || bounds[bounds.length - 1] !== k) bounds.push(k);
  }

  const upperCap = (bounds[bounds.length - 1] ?? currentPrice) * 1024n + 1n;
  const intervals: Array<[bigint, bigint]> = [];
  let prev = 1n;
  for (const k of bounds) {
    if (k > prev) intervals.push([prev, k]);
    prev = k;
  }
  if (upperCap > prev) intervals.push([prev, upperCap]);

  let down: bigint | undefined;
  let up: bigint | undefined;
  const register = (at: bigint) => {
    if (at < currentPrice) down = closer(down, at, true);
    else if (at > currentPrice) up = closer(up, at, false);
  };

  for (const [lo, hi] of intervals) {
    const sLo = f(lo);
    const sHi = f(hi);
    if ((sLo > 0n && sHi > 0n) || (sLo < 0n && sHi < 0n)) continue;
    if (sLo === 0n) {
      register(lo);
      continue;
    }
    if (sHi === 0n) {
      register(hi);
      continue;
    }
    register(bisect(lo, hi, sLo, f));
  }

  return { down, up };
}

/** Bisect `[lo, hi]` down to a single unit. Assumes `f(lo)` and `f(hi)` differ in sign. */
function bisect(
  lo: bigint,
  hi: bigint,
  sLo: bigint,
  f: (price: bigint) => bigint,
): bigint {
  let a = lo;
  let b = hi;
  let sa = sLo;
  while (b - a > 1n) {
    const mid = (a + b) / 2n;
    const sm = f(mid);
    if (sm === 0n) return mid;
    if ((sa < 0n && sm < 0n) || (sa > 0n && sm > 0n)) {
      a = mid;
      sa = sm;
    } else {
      b = mid;
    }
  }
  return sa < 0n ? b : a;
}

/**
 * Keep whichever candidate is nearer the mark. Going down that is the higher
 * price; going up, the lower one.
 */
function closer(prev: bigint | undefined, candidate: bigint, isDown: boolean): bigint {
  if (prev === undefined) return candidate;
  if (isDown) return candidate > prev ? candidate : prev;
  return candidate < prev ? candidate : prev;
}
