import { alignBucketStart } from "./chartBars";

/** Oracle hashprice is 8 decimals; divide to USD. */
export const ORACLE_PRICE_SCALE = 10 ** 8;

export type SubgraphHashpriceCandle = {
  id: string | number;
  open: string;
  high: string;
  low: string;
  close: string;
  count: string;
  timestamp: string;
};

export type HashpriceCandle = {
  id: string;
  /** Bucket start, milliseconds since epoch. */
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  count: number;
};

const MIN_PRICE = 0.01;

const scalePrice = (raw: string): number => Number(raw) / ORACLE_PRICE_SCALE;

/**
 * Subgraph `Timestamp` values are microseconds. `Number(timestamp) / 1000` is
 * milliseconds, which is what `Date` and the chart's wall-clock shift expect.
 */
export const subgraphTimestampToMs = (timestamp: string): number => Number(timestamp) / 1000;

const sanitizeOhlc = (
  open: number,
  high: number,
  low: number,
  close: number,
): Pick<HashpriceCandle, "open" | "high" | "low" | "close"> => ({
  open,
  high: Math.max(open, high, close),
  low: Math.min(open, low, close),
  close,
});

export const mapHashpriceCandle = (row: SubgraphHashpriceCandle): HashpriceCandle | null => {
  const open = scalePrice(row.open);
  const high = scalePrice(row.high);
  const low = scalePrice(row.low);
  const close = scalePrice(row.close);
  const timeMs = subgraphTimestampToMs(row.timestamp);
  const count = Number(row.count);

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(timeMs) ||
    timeMs <= 0 ||
    count <= 0 ||
    open <= MIN_PRICE ||
    close <= MIN_PRICE
  ) {
    return null;
  }

  return {
    id: String(row.id),
    timeMs,
    count,
    ...sanitizeOhlc(open, high, low, close),
  };
};

/** Newest-first, matching the line-series index hooks. */
export const mapHashpriceCandles = (rows: SubgraphHashpriceCandle[]): HashpriceCandle[] =>
  rows
    .map(mapHashpriceCandle)
    .filter((candle): candle is HashpriceCandle => candle !== null)
    .sort((a, b) => b.timeMs - a.timeMs);

/**
 * Fold the live mark into the newest bucket instead of appending a point.
 * Open stays the first tick in that hour/day; close/high/low follow the mark.
 */
export const foldLivePriceIntoCandles = (
  candles: HashpriceCandle[],
  livePrice: number | undefined,
): HashpriceCandle[] => {
  if (livePrice === undefined || !Number.isFinite(livePrice) || livePrice <= MIN_PRICE || candles.length === 0) {
    return candles;
  }

  const latest = candles[0];
  if (latest.close === livePrice) return candles;

  return [
    {
      ...latest,
      ...sanitizeOhlc(latest.open, latest.high, latest.low, livePrice),
    },
    ...candles.slice(1),
  ];
};

export type PriceTick = {
  id: string | number;
  timeMs: number;
  price: number;
};

/** Build OHLC bars from raw oracle ticks (used for 15m). Newest-first. */
export const candlesFromTicks = (ticks: PriceTick[], intervalMs: number): HashpriceCandle[] => {
  const groups = new Map<number, PriceTick[]>();
  for (const tick of ticks) {
    if (!Number.isFinite(tick.price) || tick.price <= MIN_PRICE || !Number.isFinite(tick.timeMs) || tick.timeMs <= 0) {
      continue;
    }
    const bucket = alignBucketStart(tick.timeMs, intervalMs);
    const list = groups.get(bucket);
    if (list) list.push(tick);
    else groups.set(bucket, [tick]);
  }

  const candles: HashpriceCandle[] = [];
  for (const [timeMs, items] of groups) {
    items.sort((a, b) => a.timeMs - b.timeMs);
    const open = items[0].price;
    const close = items[items.length - 1].price;
    let high = open;
    let low = open;
    for (const item of items) {
      if (item.price > high) high = item.price;
      if (item.price < low) low = item.price;
    }
    candles.push({
      id: String(items[0].id),
      timeMs,
      count: items.length,
      ...sanitizeOhlc(open, high, low, close),
    });
  }
  return candles.sort((a, b) => b.timeMs - a.timeMs);
};

/** Roll finer OHLC bars into a coarser interval (hour → 12h). Newest-first. */
export const rollupHashpriceCandles = (candles: HashpriceCandle[], intervalMs: number): HashpriceCandle[] => {
  const groups = new Map<number, HashpriceCandle[]>();
  for (const candle of candles) {
    const bucket = alignBucketStart(candle.timeMs, intervalMs);
    const list = groups.get(bucket);
    if (list) list.push(candle);
    else groups.set(bucket, [candle]);
  }

  const rolled: HashpriceCandle[] = [];
  for (const [timeMs, items] of groups) {
    items.sort((a, b) => a.timeMs - b.timeMs);
    const first = items[0];
    const last = items[items.length - 1];
    rolled.push({
      id: first.id,
      timeMs,
      count: items.reduce((sum, item) => sum + item.count, 0),
      ...sanitizeOhlc(
        first.open,
        Math.max(...items.map((item) => item.high)),
        Math.min(...items.map((item) => item.low)),
        last.close,
      ),
    });
  }
  return rolled.sort((a, b) => b.timeMs - a.timeMs);
};
