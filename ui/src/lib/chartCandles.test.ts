import { describe, expect, it } from "vitest";
import {
  candlesFromTicks,
  foldLivePriceIntoCandles,
  mapHashpriceCandle,
  mapHashpriceCandles,
  rollupHashpriceCandles,
  subgraphTimestampToMs,
  type HashpriceCandle,
  type SubgraphHashpriceCandle,
} from "./chartCandles";

const PRICE_SCALE = 10 ** 8;

const row = (overrides: Partial<SubgraphHashpriceCandle> = {}): SubgraphHashpriceCandle => ({
  id: "1",
  open: String(40 * PRICE_SCALE),
  high: String(42 * PRICE_SCALE),
  low: String(39 * PRICE_SCALE),
  close: String(41 * PRICE_SCALE),
  count: "12",
  timestamp: "1786089600000000",
  ...overrides,
});

describe("subgraphTimestampToMs", () => {
  it("converts microsecond timestamps to milliseconds", () => {
    expect(subgraphTimestampToMs("1786089600000000")).toBe(1_786_089_600_000);
  });
});

describe("mapHashpriceCandle", () => {
  it("scales 8-decimal oracle prices to USD", () => {
    expect(mapHashpriceCandle(row())).toEqual({
      id: "1",
      timeMs: 1_786_089_600_000,
      open: 40,
      high: 42,
      low: 39,
      close: 41,
      count: 12,
    });
  });

  it("widens high/low so they always enclose open and close", () => {
    expect(mapHashpriceCandle(row({ high: String(40.5 * PRICE_SCALE), low: String(40.5 * PRICE_SCALE) }))).toMatchObject({
      open: 40,
      high: 41,
      low: 40,
      close: 41,
    });
  });

  it("drops empty or near-zero buckets", () => {
    expect(mapHashpriceCandle(row({ count: "0" }))).toBeNull();
    expect(mapHashpriceCandle(row({ close: "0" }))).toBeNull();
    expect(mapHashpriceCandle(row({ open: String(0.001 * PRICE_SCALE) }))).toBeNull();
  });
});

describe("mapHashpriceCandles", () => {
  it("sorts newest first and skips invalid rows", () => {
    const mapped = mapHashpriceCandles([
      row({ id: "old", timestamp: "1786086000000000", close: String(30 * PRICE_SCALE) }),
      row({ id: "bad", count: "0" }),
      row({ id: "new", timestamp: "1786089600000000", close: String(41 * PRICE_SCALE) }),
    ]);

    expect(mapped.map((candle) => candle.id)).toEqual(["new", "old"]);
  });
});

describe("foldLivePriceIntoCandles", () => {
  const candles: HashpriceCandle[] = [
    { id: "new", timeMs: 2, open: 40, high: 42, low: 39, close: 41, count: 8 },
    { id: "old", timeMs: 1, open: 38, high: 40, low: 37, close: 40, count: 10 },
  ];

  it("updates the newest close/high/low and leaves open alone", () => {
    expect(foldLivePriceIntoCandles(candles, 43)).toEqual([
      { id: "new", timeMs: 2, open: 40, high: 43, low: 39, close: 43, count: 8 },
      candles[1],
    ]);
  });

  it("pulls low down when the mark prints below the bucket", () => {
    expect(foldLivePriceIntoCandles(candles, 38)[0]).toMatchObject({
      open: 40,
      high: 42,
      low: 38,
      close: 38,
    });
  });

  it("is a no-op when the mark matches close or is missing", () => {
    expect(foldLivePriceIntoCandles(candles, 41)).toBe(candles);
    expect(foldLivePriceIntoCandles(candles, undefined)).toBe(candles);
    expect(foldLivePriceIntoCandles([], 43)).toEqual([]);
  });
});

describe("candlesFromTicks", () => {
  it("builds 30-minute OHLC from ticks", () => {
    const interval = 30 * 60 * 1000;
    const t0 = 1_786_089_600_000;
    const bars = candlesFromTicks(
      [
        { id: "o", timeMs: t0 + 1_000, price: 40 },
        { id: "h", timeMs: t0 + 60_000, price: 45 },
        { id: "c", timeMs: t0 + 120_000, price: 42 },
        { id: "next", timeMs: t0 + interval + 1_000, price: 41 },
      ],
      interval,
    );

    expect(bars).toHaveLength(2);
    expect(bars[1]).toMatchObject({ timeMs: t0, open: 40, high: 45, low: 40, close: 42, count: 3 });
    expect(bars[0]).toMatchObject({ timeMs: t0 + interval, open: 41, close: 41, count: 1 });
  });
});

describe("rollupHashpriceCandles", () => {
  it("merges hourly OHLC into 4-hour bars", () => {
    const hour = 60 * 60 * 1000;
    const t0 = 1_786_089_600_000;
    const bar = (timeMs: number, open: number, high: number, low: number, close: number): HashpriceCandle => ({
      id: String(timeMs),
      timeMs,
      open,
      high,
      low,
      close,
      count: 1,
    });

    const rolled = rollupHashpriceCandles(
      [bar(t0 + 3 * hour, 44, 46, 43, 45), bar(t0 + hour, 41, 42, 40, 42), bar(t0, 40, 41, 39, 41)],
      4 * hour,
    );

    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatchObject({ timeMs: t0, open: 40, high: 46, low: 39, close: 45, count: 3 });
  });
});
