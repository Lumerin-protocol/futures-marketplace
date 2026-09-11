import { describe, expect, it } from "vitest";
import { alignBucketStart, chartRangeSpec, rollupAverageTicks } from "./chartBars";

describe("chartRangeSpec", () => {
  it("uses ticks for 1D 15m, Goldsky hours for 5D, and 12h rollups for 1M", () => {
    expect(chartRangeSpec("1d")).toEqual({
      intervalMs: 15 * 60 * 1000,
      windowMs: 24 * 60 * 60 * 1000,
      source: "tick",
    });
    expect(chartRangeSpec("5d")).toEqual({
      intervalMs: 60 * 60 * 1000,
      windowMs: 5 * 24 * 60 * 60 * 1000,
      source: "hour",
    });
    expect(chartRangeSpec("1m")).toEqual({
      intervalMs: 12 * 60 * 60 * 1000,
      windowMs: 31 * 24 * 60 * 60 * 1000,
      source: "hour",
    });
  });
});

describe("rollupAverageTicks", () => {
  it("merges ticks into 30-minute buckets", () => {
    const interval = 30 * 60 * 1000;
    const t0 = alignBucketStart(1_786_089_600_000, interval);
    const rolled = rollupAverageTicks(
      [
        { id: "a", timeMs: t0 + 60_000, sum: 40, count: 1 },
        { id: "b", timeMs: t0 + 10 * 60_000, sum: 44, count: 1 },
        { id: "c", timeMs: t0 + interval + 1_000, sum: 50, count: 1 },
      ],
      interval,
    );

    expect(rolled).toHaveLength(2);
    expect(rolled[1]).toMatchObject({ timeMs: t0, sum: 84, count: 2 });
    expect(rolled[0]).toMatchObject({ timeMs: t0 + interval, sum: 50, count: 1 });
  });
});
