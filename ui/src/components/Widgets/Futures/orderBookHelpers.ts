import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";

export interface OrderBookData {
  bidUnits: number | null;
  price: number;
  askUnits: number | null;
  isHighlighted?: boolean;
  highlightColor?: "red" | "green";
  isLastHashprice?: boolean;
}

/**
 * Per-price aggregated row consumed by the order-book renderer. Both futures
 * `priceLevels` and perps `priceLevels` get reduced to this shape upstream.
 */
export interface AggregatedOrderBookEntry {
  price: bigint;
  buyOrdersCount: number;
  sellOrdersCount: number;
}

// The contiguous ladder spans +/- this fraction of the market price so every
// tick between orders is selectable (e.g. market $10 -> $5..$15). Real orders
// falling outside this band still expand the range so no live level is hidden.
const LADDER_WINDOW_FRACTION = 0.5;

/**
 * Builds the order book ladder rendered by the volume view. Instead of showing
 * only the price levels that have resting orders (which collapses gaps between
 * e.g. a bid at $3 and $4), this emits a *contiguous* row for every tick in a
 * band around the market price, merging live bid/ask quantities where present
 * and leaving empty (but still selectable) rows everywhere else.
 *
 * All arithmetic is done in integer "tick" units (`round(price / increment)`)
 * to avoid floating point drift when accumulating the increment thousands of
 * times, and to guarantee live levels land on the exact same slot as the
 * generated ladder.
 *
 * @param orderBookData - Pre-aggregated per-price data (buyOrdersCount / sellOrdersCount)
 * @param marketPrice - Market price from the contract (payment-token scaled)
 * @param minimumPriceIncrement - Tick size in human units (e.g. 0.01), mode-aware
 * @returns Contiguous ladder rows sorted high -> low price
 */
export const createFinalOrderBookData = (
  orderBookData: AggregatedOrderBookEntry[],
  marketPrice: bigint | null | undefined,
  minimumPriceIncrement: number | null,
): OrderBookData[] => {
  const inc = minimumPriceIncrement;

  // Group live data by integer tick so it aligns exactly with the ladder slots.
  const liveByTick = new Map<number, { bidUnits: number | null; askUnits: number | null }>();
  let minLiveTick = Infinity;
  let maxLiveTick = -Infinity;

  if (inc !== null && inc > 0 && orderBookData && orderBookData.length > 0) {
    for (const order of orderBookData) {
      const rawPrice = Number(order.price) / PAYMENT_TOKEN_SCALE_NUM; // scaled -> human units
      const tick = Math.round(rawPrice / inc);
      liveByTick.set(tick, {
        bidUnits: order.buyOrdersCount > 0 ? order.buyOrdersCount : null,
        askUnits: order.sellOrdersCount > 0 ? order.sellOrdersCount : null,
      });
      minLiveTick = Math.min(minLiveTick, tick);
      maxLiveTick = Math.max(maxLiveTick, tick);
    }
  }

  const rawMarketPrice =
    marketPrice != null ? Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM : null;

  // Fallback: without a market price or tick size we cannot build a contiguous
  // band, so render just the live levels (sorted high -> low), as before.
  if (inc === null || inc <= 0 || rawMarketPrice === null) {
    return Array.from(liveByTick.entries())
      .map(([tick, live]) => ({
        price: inc && inc > 0 ? tick * inc : tick,
        bidUnits: live.bidUnits,
        askUnits: live.askUnits,
        isLastHashprice: false,
      }))
      .sort((a, b) => b.price - a.price);
  }

  const marketTick = Math.round(rawMarketPrice / inc);
  let lowTick = Math.round((rawMarketPrice * (1 - LADDER_WINDOW_FRACTION)) / inc);
  let highTick = Math.round((rawMarketPrice * (1 + LADDER_WINDOW_FRACTION)) / inc);

  // Prices must stay positive; never generate a $0 (or negative) tick.
  lowTick = Math.max(1, lowTick);

  // Expand the band so any live level outside +/-50% is still shown.
  if (minLiveTick !== Infinity) {
    lowTick = Math.max(1, Math.min(lowTick, minLiveTick));
    highTick = Math.max(highTick, maxLiveTick);
  }

  const rows: OrderBookData[] = [];
  for (let tick = highTick; tick >= lowTick; tick--) {
    const live = liveByTick.get(tick);
    rows.push({
      price: tick * inc,
      bidUnits: live?.bidUnits ?? null,
      askUnits: live?.askUnits ?? null,
      isLastHashprice: tick === marketTick,
    });
  }

  return rows;
};

/**
 * Pre-#209 order book builder used by the perpetuals volume view. Unlike the
 * contiguous ladder produced by `createFinalOrderBookData`, this emits only a
 * small static window of empty rows (+/- `offsetAroundBasePrice` ticks around
 * the base/market price) merged with the live levels, plus any live levels that
 * fall outside that window. The perps volume renderer then filters to live
 * levels and re-pads, so the net effect is a compact book with no empty gaps
 * between real price levels.
 *
 * @param orderBookData - Pre-aggregated per-price data (buyOrdersCount / sellOrdersCount)
 * @param marketPrice - Market price from the contract (payment-token scaled)
 * @param minimumPriceIncrement - Tick size in human units (e.g. 0.01), mode-aware
 * @returns Merged and sorted order book data (high -> low price)
 */
export const createPerpsOrderBookData = (
  orderBookData: AggregatedOrderBookEntry[],
  marketPrice: bigint | null | undefined,
  minimumPriceIncrement: number | null,
): OrderBookData[] => {
  // Calculate basePrice from market price (used for highlighting and calculating order book)
  let basePrice: number | null = null;
  if (marketPrice && minimumPriceIncrement !== null) {
    const rawPrice = Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM; // Convert from wei to USDC
    // Round to the nearest multiple of minimumPriceIncrement
    basePrice = Math.round(rawPrice / minimumPriceIncrement) * minimumPriceIncrement;
  }

  // Calculate static order book data based on hashrate
  let calculatedOrderBookData: { price: number; bidUnits: number | null; askUnits: number | null }[] = [];
  const offsetAroundBasePrice = 12;

  if (basePrice !== null && minimumPriceIncrement !== null) {
    const staticOrderBookRows = [];

    // Create items before the base price
    for (let i = offsetAroundBasePrice; i >= 1; i--) {
      const price = basePrice - i * minimumPriceIncrement;
      staticOrderBookRows.push({
        price: price,
        bidUnits: null,
        askUnits: null,
      });
    }

    // Add the base price
    staticOrderBookRows.push({
      price: basePrice,
      bidUnits: null,
      askUnits: null,
    });

    // Create items after the base price
    for (let i = 1; i <= offsetAroundBasePrice; i++) {
      const price = basePrice + i * minimumPriceIncrement;
      staticOrderBookRows.push({
        price: price,
        bidUnits: null,
        askUnits: null,
      });
    }

    calculatedOrderBookData = staticOrderBookRows;
  }

  // Helper function to normalize price to consistent precision
  // If minimumPriceIncrement is available, round to nearest multiple
  // Otherwise, round to 2 decimal places
  const normalizePrice = (price: number): number => {
    if (minimumPriceIncrement !== null) {
      // Round to nearest multiple of minimumPriceIncrement to match calculated prices
      return Math.round(price / minimumPriceIncrement) * minimumPriceIncrement;
    }
    // Fallback to 2 decimal places
    return Math.round(price * 100) / 100;
  };

  // Use pre-aggregated data directly - no need to group by price/side since it's already aggregated
  const liveGroupedMap = new Map<number, { bidUnits: number | null; askUnits: number | null }>();

  if (orderBookData && orderBookData.length > 0) {
    for (const order of orderBookData) {
      const rawPrice = Number(order.price) / PAYMENT_TOKEN_SCALE_NUM; // Convert from wei to USDC
      const price = normalizePrice(rawPrice); // Normalize to consistent precision

      // Data is already aggregated with buyOrdersCount and sellOrdersCount
      liveGroupedMap.set(price, {
        bidUnits: order.buyOrdersCount > 0 ? order.buyOrdersCount : null,
        askUnits: order.sellOrdersCount > 0 ? order.sellOrdersCount : null,
      });
    }
  }

  // No ladder when market price or tick size is unavailable — show live book only
  if (calculatedOrderBookData.length === 0) {
    return Array.from(liveGroupedMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([price, live]) => ({
        price,
        bidUnits: live.bidUnits,
        askUnits: live.askUnits,
        isLastHashprice: false,
      }));
  }

  const normalizedBasePrice = normalizePrice(basePrice!);
  const ladderPriceSet = new Set<number>();
  let ladderMin = Infinity;
  let ladderMax = -Infinity;

  for (const row of calculatedOrderBookData) {
    const price = normalizePrice(row.price);
    ladderPriceSet.add(price);
    ladderMin = Math.min(ladderMin, price);
    ladderMax = Math.max(ladderMax, price);
  }

  const ladderRows: OrderBookData[] = calculatedOrderBookData.map((row) => {
    const price = normalizePrice(row.price);
    const live = liveGroupedMap.get(price);
    return {
      price,
      bidUnits: live?.bidUnits ?? null,
      askUnits: live?.askUnits ?? null,
      isLastHashprice: price === normalizedBasePrice,
    };
  });

  const aboveExtras: OrderBookData[] = [];
  const belowExtras: OrderBookData[] = [];

  for (const [price, live] of liveGroupedMap.entries()) {
    if (ladderPriceSet.has(price)) {
      continue;
    }

    const extraRow: OrderBookData = {
      price,
      bidUnits: live.bidUnits,
      askUnits: live.askUnits,
      isLastHashprice: false,
    };

    if (price > ladderMax) {
      aboveExtras.push(extraRow);
    } else if (price < ladderMin) {
      belowExtras.push(extraRow);
    } else {
      // Price within numeric ladder range but not on a ladder slot (shouldn't happen with consistent tick size)
      if (price > normalizedBasePrice) {
        aboveExtras.push(extraRow);
      } else {
        belowExtras.push(extraRow);
      }
    }
  }

  aboveExtras.sort((a, b) => b.price - a.price);
  belowExtras.sort((a, b) => b.price - a.price);
  ladderRows.sort((a, b) => b.price - a.price);

  return [...aboveExtras, ...ladderRows, ...belowExtras];
};
