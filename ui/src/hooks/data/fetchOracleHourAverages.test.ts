import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestOracleAggregation } = vi.hoisted(() => ({ requestOracleAggregation: vi.fn() }));
vi.mock("./oracleCurrentBucket", () => ({ requestOracleAggregation }));

const { fetchOracleHourAggRows, fetchOracleHourCandles } = await import("./fetchOracleHourAverages");

const HOUR_MICROS = 3_600_000_000n;
/** An exact hour boundary, so the tests can reason in offsets from it. */
const HOUR = 1_788_732_000_000_000n;

const aggRow = (timestamp: bigint) => ({
  id: String(timestamp),
  sum: "10",
  count: "1",
  timestamp: String(timestamp),
});

const candles = (...timestamps: bigint[]) => ({
  hashpriceUsdCandles: timestamps.map(aggRow),
  btcUsdCandles: timestamps.map(aggRow),
  networkHashrate7DCandles: timestamps.map(aggRow),
});

const startOf = (call: number) => requestOracleAggregation.mock.calls[call][1].startTimestamp;

beforeEach(async () => {
  requestOracleAggregation.mockReset();
  // Drain any request the previous test left in flight.
  requestOracleAggregation.mockResolvedValue(candles());
  await fetchOracleHourCandles(String(HOUR));
  requestOracleAggregation.mockReset();
});

describe("fetchOracleHourCandles", () => {
  it("serves the three charts from one request", async () => {
    requestOracleAggregation.mockResolvedValue(candles(HOUR));

    // The charts mount together, each computing its own `Date.now()`, so their
    // starts land a millisecond or two apart.
    const results = await Promise.all([
      fetchOracleHourCandles(String(HOUR + 1_000n)),
      fetchOracleHourCandles(String(HOUR + 2_000n)),
      fetchOracleHourCandles(String(HOUR + 2_000n)),
    ]);

    expect(requestOracleAggregation).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
  });

  it("floors the request to the hour the candles bucket by", async () => {
    requestOracleAggregation.mockResolvedValue(candles());
    await fetchOracleHourCandles(String(HOUR + HOUR_MICROS / 2n));

    expect(startOf(0)).toBe(String(HOUR));
  });

  it("keeps separate chart ranges apart", async () => {
    requestOracleAggregation.mockResolvedValue(candles());
    await Promise.all([
      fetchOracleHourCandles(String(HOUR)),
      fetchOracleHourCandles(String(HOUR - HOUR_MICROS)),
    ]);

    expect(requestOracleAggregation).toHaveBeenCalledTimes(2);
  });

  it("does not strand later callers when the request fails", async () => {
    requestOracleAggregation.mockRejectedValueOnce(new Error("rate limited"));
    await expect(fetchOracleHourCandles(String(HOUR))).rejects.toThrow("rate limited");

    requestOracleAggregation.mockResolvedValueOnce(candles(HOUR));
    await expect(fetchOracleHourCandles(String(HOUR))).resolves.toBeDefined();
  });
});

describe("fetchOracleHourAggRows", () => {
  it("returns only its own series", async () => {
    requestOracleAggregation.mockResolvedValue({
      ...candles(HOUR),
      btcUsdCandles: [{ ...aggRow(HOUR), sum: "999" }],
    });

    await expect(fetchOracleHourAggRows("btcUsdCandles", String(HOUR))).resolves.toEqual([
      { ...aggRow(HOUR), sum: "999" },
    ]);
  });

  it("drops the rows the flooring pulled in below the caller's range", async () => {
    requestOracleAggregation.mockResolvedValue(candles(HOUR, HOUR + HOUR_MICROS));
    const start = HOUR + HOUR_MICROS / 2n;

    const rows = await fetchOracleHourAggRows("networkHashrate7DCandles", String(start));

    expect(rows.map((row) => row.timestamp)).toEqual([String(HOUR + HOUR_MICROS)]);
  });
});
