import { describe, expect, it } from "vitest";
import { EmptyCandleDataError, isEmptyCandleDataError, requireCandles } from "./useHashpriceCandles";
import type { HashpriceCandle } from "../../lib/chartCandles";

const candle: HashpriceCandle = {
  id: "1",
  timeMs: 1,
  open: 40,
  high: 41,
  low: 39,
  close: 40,
  count: 4,
};

describe("requireCandles", () => {
  it("returns candles that exist", () => {
    expect(requireCandles([candle], "5d")).toEqual([candle]);
  });

  it("throws a non-retriable empty error", () => {
    expect(() => requireCandles([], "5d")).toThrow(EmptyCandleDataError);
    try {
      requireCandles([], "5d");
    } catch (error) {
      expect(isEmptyCandleDataError(error)).toBe(true);
    }
  });
});

describe("isEmptyCandleDataError", () => {
  it("does not treat other failures as empty", () => {
    expect(isEmptyCandleDataError(new Error("network"))).toBe(false);
    expect(isEmptyCandleDataError("nope")).toBe(false);
  });
});
