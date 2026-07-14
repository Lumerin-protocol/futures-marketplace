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
