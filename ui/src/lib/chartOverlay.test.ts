import { describe, expect, it } from "vitest";
import { byTimeMs, byUpdatedAt, currentBucketStartMs, spliceNewestBuckets } from "./chartOverlay";

const HOUR = 3_600_000;

/** Bars are newest-first, keyed by bucket start, as all three series produce. */
const bar = (updatedAt: number, value: number) => ({
  updatedAt,
  updatedAtDate: new Date(updatedAt),
  id: `avg-${updatedAt}`,
  value,
});

describe("the bucket in progress", () => {
  it("is the bucket containing now", () => {
    expect(currentBucketStartMs(HOUR, 5 * HOUR + 1_234)).toBe(5 * HOUR);
  });

  it("starts exactly on a boundary", () => {
    expect(currentBucketStartMs(HOUR, 5 * HOUR)).toBe(5 * HOUR);
  });
});

describe("splicing the newest bars over a cached range", () => {
  const cached = [bar(3 * HOUR, 30), bar(2 * HOUR, 20), bar(1 * HOUR, 10)];

  it("replaces the bar in progress with the freshly fetched one", () => {
    const merged = spliceNewestBuckets(cached, [bar(3 * HOUR, 33)], 3 * HOUR, byUpdatedAt);

    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ updatedAt: 3 * HOUR, value: 33 });
    // The bars behind it are historical and must not be touched.
    expect(merged.slice(1)).toEqual(cached.slice(1));
  });

  it("appends a bar the cached range does not have yet", () => {
    // The first poll after the clock rolls into a new hour.
    const merged = spliceNewestBuckets(cached, [bar(4 * HOUR, 40)], 4 * HOUR, byUpdatedAt);

    expect(merged).toHaveLength(4);
    expect(merged[0]).toMatchObject({ updatedAt: 4 * HOUR, value: 40 });
    expect(merged[3]).toMatchObject({ updatedAt: HOUR, value: 10 });
  });

  it("replaces several bars when the overlay spans more than one", () => {
    // A 12h bar on the 1M range is built from several hourly rows.
    const merged = spliceNewestBuckets(cached, [bar(3 * HOUR, 33), bar(2 * HOUR, 22)], 2 * HOUR, byUpdatedAt);

    expect(merged).toEqual([bar(3 * HOUR, 33), bar(2 * HOUR, 22), bar(HOUR, 10)]);
  });

  it("returns the very same array when nothing moved", () => {
    // Identity, not just equality: this is what stops a cache write and a
    // re-render on every one of the 720 polls an hour that change nothing.
    const merged = spliceNewestBuckets(cached, [bar(3 * HOUR, 30)], 3 * HOUR, byUpdatedAt);
    expect(merged).toBe(cached);
  });

  it("keeps the cached range when the overlay comes back empty", () => {
    const merged = spliceNewestBuckets(cached, [], 4 * HOUR, byUpdatedAt);
    expect(merged).toBe(cached);
  });

  it("drops a bar whose source rows have gone", () => {
    // An empty overlay inside the cached range is authoritative: the bar had
    // rows behind it and no longer does.
    const merged = spliceNewestBuckets(cached, [], 3 * HOUR, byUpdatedAt);
    expect(merged).toEqual(cached.slice(1));
  });

  it("notices a change in any field, not just the value", () => {
    const moved = [{ ...cached[0], id: "avg-different" }];
    expect(spliceNewestBuckets(cached, moved, 3 * HOUR, byUpdatedAt)).not.toBe(cached);
  });

  it("does not treat a re-created Date as a change", () => {
    const rebuilt = [bar(3 * HOUR, 30)];
    expect(rebuilt[0].updatedAtDate).not.toBe(cached[0].updatedAtDate);
    expect(spliceNewestBuckets(cached, rebuilt, 3 * HOUR, byUpdatedAt)).toBe(cached);
  });

  it("copes with an empty cache", () => {
    const merged = spliceNewestBuckets([], [bar(3 * HOUR, 30)], 3 * HOUR, byUpdatedAt);
    expect(merged).toEqual([bar(3 * HOUR, 30)]);
  });

  it("splices candles, which key their bars by a different field", () => {
    const candle = (timeMs: number, close: number) => ({
      id: `c-${timeMs}`,
      timeMs,
      open: 1,
      high: 2,
      low: 0,
      close,
      count: 1,
    });
    const candles = [candle(3 * HOUR, 30), candle(2 * HOUR, 20)];

    const merged = spliceNewestBuckets(candles, [candle(3 * HOUR, 33)], 3 * HOUR, byTimeMs);
    expect(merged[0]).toMatchObject({ timeMs: 3 * HOUR, close: 33 });
    expect(merged[1]).toBe(candles[1]);
  });
});
