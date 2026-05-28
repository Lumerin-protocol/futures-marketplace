import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
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

/**
 * Creates the final order book data by merging live aggregated order book data with calculated static data
 * @param orderBookData - Pre-aggregated order book data from the API (already has buyOrdersCount and sellOrdersCount)
 * @param marketPrice - Market price from the Futures contract
 * @param contractSpecs - Contract specifications including price ladder step
 * @returns Final merged and sorted order book data
 */
export const createFinalOrderBookData = (
  orderBookData: AggregatedOrderBookEntry[],
  marketPrice: bigint | null | undefined,
  contractSpecs: FuturesContractSpecs | undefined,
): OrderBookData[] => {
  // Calculate minimumPriceIncrement once for reuse
  const minimumPriceIncrement = contractSpecs ? Number(contractSpecs.minimumPriceIncrement) / PAYMENT_TOKEN_SCALE_NUM : null; // Convert from wei to USDC

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

    // Create 10 items before the base price
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

    // Create 10 items after the base price
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
