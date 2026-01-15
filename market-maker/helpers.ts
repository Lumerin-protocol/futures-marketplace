import { formatUnits } from "viem/utils";
import { abs, mult } from "./lib.ts";
import { type Order } from "./subgraph.ts";

/**
 * Calculate the orders needed to transition from currentOrders to modelledOrders.
 * Orders at the same price offset each other: +1 and -1 net to 0.
 *
 * @param modelledOrders - The target orders we want to have
 * @param currentOrders - The orders we currently have
 * @returns Orders to place to achieve the modelled state (only non-zero quantities)
 */
export function calculateOrders(modelledOrders: Order[], currentOrders: Order[]): Order[] {
  // Aggregate quantities by price for both modelled and current orders
  const modelledByPrice = new Map<bigint, bigint>();
  for (const order of modelledOrders) {
    const existing = modelledByPrice.get(order.price) ?? 0n;
    modelledByPrice.set(order.price, existing + order.qty);
  }

  const currentByPrice = new Map<bigint, bigint>();
  for (const order of currentOrders) {
    const existing = currentByPrice.get(order.price) ?? 0n;
    currentByPrice.set(order.price, existing + order.qty);
  }

  // Get all unique price levels
  const allPrices = new Set([...modelledByPrice.keys(), ...currentByPrice.keys()]);

  // Calculate the difference at each price level
  const ordersToPlace: Order[] = [];
  for (const price of allPrices) {
    const modelledQty = modelledByPrice.get(price) ?? 0n;
    const currentQty = currentByPrice.get(price) ?? 0n;
    const diff = modelledQty - currentQty;

    // Only include non-zero differences
    if (diff !== 0n) {
      ordersToPlace.push({ price, qty: diff });
    }
  }

  // Sort by price for consistent ordering (optional, but nice for logging)
  ordersToPlace.sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));

  return ordersToPlace;
}

/**
 * Exponential / geometric taper ladder sizing.
 *
 * Levels are i = 0..N-1 (0 = closest/top, N-1 = deepest)
 * Unnormalized weight: u_i = alpha^i, with 0 < alpha < 1 (taper)
 * Normalized weight:   w_i = u_i / sum(u)
 *
 * Returns allocations in quote-currency (e.g., USD notional) per level.
 */
export function geometricTaperAllocations(
  perSideBudget: bigint, // e.g. 1000
  levels: number, // N, e.g. 4
  alpha = 0.6 // 0<alpha<1 => decreasing sizes deeper
) {
  if (!(levels >= 0)) throw new Error("levels must be >= 0");
  if (!(alpha > 0 && alpha < 1)) throw new Error("alpha must be > 0 and < 1");

  if (levels === 0) return { perSideBudget, weights: [], allocations: [] };

  // unnormalized weights u_i = alpha^i
  const u = Array.from({ length: levels }, (_, i) => Math.pow(alpha, i));

  // sum(u)
  const sumU = u.reduce((a, b) => a + b, 0);

  // normalized weights and allocations
  const weights = u.map((ui) => ui / sumU);
  const allocations = weights.map((wi) => mult(perSideBudget, wi));

  return { perSideBudget, weights, allocations };
}

// convert currency allocations to notional allocations, making sure to distribute as much as possible
export function currencyToNotionalAllocations(
  currencyAllocations: bigint[],
  contractValues: bigint[]
) {
  if (currencyAllocations.length !== contractValues.length) {
    throw new Error(
      `currencyAllocations and contractValues must have the same length: ${currencyAllocations.length} !== ${contractValues.length}`
    );
  }
  let baseAllocations: bigint[] = Array(currencyAllocations.length);
  let remainders: bigint[] = Array(currencyAllocations.length);
  let totalRemainder: bigint = 0n;
  for (let i = 0; i < currencyAllocations.length; i++) {
    const baseAllocation = currencyAllocations[i] / contractValues[i];
    const remainder = currencyAllocations[i] % contractValues[i];
    baseAllocations[i] = baseAllocation;
    remainders[i] = remainder;
    totalRemainder += remainder;
  }

  // Create result array starting with base allocations
  const result = [...baseAllocations];

  // Distribute extra contracts to entries with largest remainders
  const indices = remainders
    .map((r, i) => ({ remainder: r, index: i }))
    .sort((a, b) => Number(b.remainder - a.remainder));

  for (const { index } of indices) {
    const value = contractValues[index];
    if (totalRemainder >= value) {
      result[index] += 1n;
      totalRemainder -= value;
    }
  }

  return { result, remainder: totalRemainder };
}

/**
 * Calculate the reservation price (price adjusted for inventory and volatility) using Avellaneda-Stoikov model
 * https://hummingbot.org/blog/guide-to-the-avellaneda--stoikov-strategy
 */
export function calculateReservationPrice(
  marketPrice: bigint,
  quantityOfTheBaseAsset: bigint,
  riskAversion: bigint,
  volatility: number,
  remainingTime: number
) {
  const inventoryAdjustment = mult(
    quantityOfTheBaseAsset * riskAversion,
    volatility ** 2 * remainingTime
  );
  return marketPrice + inventoryAdjustment;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Resample irregular {date, price} points into 1-hour close prices.
 * - close = last observed price in that hour
 * - fill = "locf": fill missing hours with last close (LOCF)
 */
export function resampleHourlyClose(
  prices: { date: number; price: bigint }[],
  resampleInterval: number = HOUR_MS
) {
  const pts = (prices ?? []).sort((a, b) => a.date - b.date);

  if (pts.length === 0) return [];

  const bucketStart = (t: number) => Math.floor(t / resampleInterval) * resampleInterval;

  // closeByHour[hourStart] = last price in that hour (because we overwrite in sorted order)
  const closeByHour = new Map<number, bigint>();
  for (const p of pts) {
    closeByHour.set(bucketStart(p.date), p.price);
  }

  const start = bucketStart(pts[0].date);
  const end = bucketStart(pts[pts.length - 1].date);
  const result: { date: number; price: bigint }[] = [];

  let last = null;
  for (let h = start; h <= end; h += resampleInterval) {
    const price = closeByHour.has(h) ? closeByHour.get(h) : last; // LOCF
    if (price != null) {
      // fill missing hours with last close
      result.push({ date: h, price });
      last = price;
    }
  }
  return result;
}

/**
 * Realized volatility from a price series: stddev of log returns.
 *
 * Input: [{ date: number, price: number }, ...]  // date = ms since epoch (or any sortable number)
 * Output:
 *   - sigmaPerStep: volatility per sample step (std dev of consecutive log returns)
 *   - sigmaAnnualized: optional annualized vol if you tell it how many steps per year
 *
 * Uses: r_t = ln(P_t / P_{t-1}), then sigma = stdev(r_t).
 */
export function realizedVolatility(prices: { date: number; price: bigint }[], sample = true) {
  // 1) sort & clean
  const pts = (prices ?? [])
    .map((p) => {
      if (p.price <= 0n) {
        throw new Error(`Invalid p.price: ${p}`);
      }
      if (!Number.isFinite(p.date) || p.date <= 0) {
        throw new Error(`Invalid p.date: ${p}`);
      }
      return { date: p.date, price: Number(p.price) };
    })
    .sort((a, b) => a.date - b.date);

  // 2) compute log returns
  const returns: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1].price;
    const p1 = pts[i].price;
    // log return r = ln(p1/p0)
    returns.push(Math.log(p1 / p0));
  }

  if (pts.length < 2) {
    return { sigmaPerStep: 0 };
  }

  // 3) mean
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;

  // 4) variance
  const denom = sample ? returns.length - 1 : returns.length;
  const variance =
    returns.reduce((s, x) => {
      const d = x - mean;
      return s + d * d;
    }, 0) / denom;

  const sigmaPerStep = Math.sqrt(variance); // stdev = sqrt(variance) [web:343]

  return { sigmaPerStep };
}

export function generateContractValues(price: bigint, tickSize: bigint, levels: number): bigint[] {
  const absLevels = Math.abs(levels);
  const direction = levels < 0 ? -1n : 1n;
  let array: bigint[] = Array(absLevels);
  for (let i = 0; i < absLevels; i++) {
    array[i] = price + direction * BigInt(i) * tickSize;
  }
  if (levels < 0) {
    array.reverse();
  }
  return array;
}

export function ordersToString(orders: { price: bigint; qty: bigint }[]): string[] {
  return orders.map((o) => `${o.qty > 0n ? "+" : "-"}${abs(o.qty)} @ $${formatUnits(o.price, 6)}`);
}
