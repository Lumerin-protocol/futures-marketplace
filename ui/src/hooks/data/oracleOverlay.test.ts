import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alignBucketStart, chartRangeSpec } from "../../lib/chartBars";
import { HASHPRICE_CHART_QK } from "./fetchHashpriceChart";
import { NETWORK_HASHRATE_INDEX_QK } from "./useNetworkHashrateIndexData";
import { BTC_PRICE_INDEX_QK } from "./useBtcPriceIndexData";

const request = vi.fn();
vi.mock("./oracleCurrentBucket", () => ({
  requestOracleAggregation: (query: string, variables: Record<string, unknown>) =>
    request(query, variables),
}));

const { fetchOracleOverlay } = await import("./oracleOverlay");

/** The oracle timestamps everything in microseconds. */
const micros = (ms: number) => String(ms * 1000);
const PRICE_SCALE = 10 ** 8;

const bucketStartMs = (range: "1d" | "5d" | "1m", now: number) =>
  alignBucketStart(now, chartRangeSpec(range).intervalMs);

let qc: QueryClient;
const NOW = Date.UTC(2026, 8, 12, 19, 20, 0);

beforeEach(() => {
  qc = new QueryClient();
  request.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("which series end up in the request", () => {
  it("asks only for the series that are switched on", async () => {
    request.mockResolvedValue({});
    await fetchOracleOverlay(qc, "5d", ["hashprice"]);

    const [document] = request.mock.calls[0];
    expect(document).toContain("hashpriceUsdCandles");
    expect(document).not.toContain("btcUsdCandles");
    expect(document).not.toContain("networkHashrate7DCandles");
  });

  it("adds a series once it is switched on", async () => {
    request.mockResolvedValue({});
    await fetchOracleOverlay(qc, "5d", ["hashprice", "networkHashrate"]);

    const [document] = request.mock.calls[0];
    expect(document).toContain("networkHashrate7DCandles");
    expect(document).not.toContain("btcUsdCandles");
  });

  it("does not fire at all when nothing is on", async () => {
    await fetchOracleOverlay(qc, "5d", []);
    expect(request).not.toHaveBeenCalled();
  });

  it("reads raw ticks on the range that buckets them, aggregations on the others", async () => {
    request.mockResolvedValue({});

    await fetchOracleOverlay(qc, "1d", ["hashprice"]);
    expect(request.mock.calls[0][0]).toContain("hashpriceUsds(");

    await fetchOracleOverlay(qc, "1m", ["hashprice"]);
    expect(request.mock.calls[1][0]).toContain("hashpriceUsdCandles(");
  });

  it("asks only for the bar in progress", async () => {
    request.mockResolvedValue({});
    await fetchOracleOverlay(qc, "5d", ["hashprice"]);

    // 19:20 falls in the hour that began at 19:00.
    expect(request.mock.calls[0][1].bucketStart).toBe(micros(bucketStartMs("5d", NOW)));
  });
});

describe("splicing the fetched bar into the chart", () => {
  const start = bucketStartMs("5d", NOW);

  it("corrects a bar that has gone stale", async () => {
    qc.setQueryData([HASHPRICE_CHART_QK, "5d"], {
      line: [
        { updatedAt: start, updatedAtDate: new Date(start), id: `avg-${start}`, priceToken: 38 },
        {
          updatedAt: start - 3_600_000,
          updatedAtDate: new Date(start - 3_600_000),
          id: `avg-${start - 3_600_000}`,
          priceToken: 37,
        },
      ],
      candles: [],
    });

    request.mockResolvedValue({
      hashpriceUsdCandles: [
        {
          id: `hour-${start}`,
          sum: String(41 * PRICE_SCALE),
          count: "1",
          timestamp: micros(start),
          open: String(41 * PRICE_SCALE),
          high: String(41 * PRICE_SCALE),
          low: String(41 * PRICE_SCALE),
          close: String(41 * PRICE_SCALE),
        },
      ],
    });

    await fetchOracleOverlay(qc, "5d", ["hashprice"]);

    const data = qc.getQueryData<{ line: { priceToken: number }[] }>([HASHPRICE_CHART_QK, "5d"]);
    expect(data?.line[0].priceToken).toBe(41);
    // The hour behind it is settled and must not move.
    expect(data?.line[1].priceToken).toBe(37);
  });

  it("leaves the entry alone when the bar has not moved", async () => {
    qc.setQueryData([HASHPRICE_CHART_QK, "5d"], {
      line: [
        { updatedAt: start, updatedAtDate: new Date(start), id: `avg-${start}`, priceToken: 38 },
      ],
      candles: [],
    });

    request.mockResolvedValue({
      hashpriceUsdCandles: [
        {
          id: `avg-${start}`,
          sum: String(38 * PRICE_SCALE),
          count: "1",
          timestamp: micros(start),
          open: String(38 * PRICE_SCALE),
          high: String(38 * PRICE_SCALE),
          low: String(38 * PRICE_SCALE),
          close: String(38 * PRICE_SCALE),
        },
      ],
    });

    // The first poll settles the bar; the second is the steady state, which is
    // what this is about — the oracle posts far less often than this runs.
    await fetchOracleOverlay(qc, "5d", ["hashprice"]);
    const settled = qc.getQueryData([HASHPRICE_CHART_QK, "5d"]);
    await fetchOracleOverlay(qc, "5d", ["hashprice"]);

    // Identity, not equality: a new object here would re-render the chart on
    // every poll, which at a 5s tick is 720 times an hour for nothing.
    expect(qc.getQueryData([HASHPRICE_CHART_QK, "5d"])).toBe(settled);
  });

  it("writes nothing when the chart has not loaded its range yet", async () => {
    request.mockResolvedValue({
      hashpriceUsdCandles: [
        {
          id: `avg-${start}`,
          sum: String(38 * PRICE_SCALE),
          count: "1",
          timestamp: micros(start),
          open: "1",
          high: "1",
          low: "1",
          close: "1",
        },
      ],
    });

    await fetchOracleOverlay(qc, "5d", ["hashprice"]);

    // The range will include this bar when it arrives; seeding a lone bar here
    // would render a chart of one point.
    expect(qc.getQueryData([HASHPRICE_CHART_QK, "5d"])).toBeUndefined();
  });

  it("scales each series the way its own chart does", async () => {
    qc.setQueryData([BTC_PRICE_INDEX_QK, "5d"], [
      { updatedAt: start, updatedAtDate: new Date(start), id: `avg-${start}`, price: 0 },
    ]);
    qc.setQueryData([NETWORK_HASHRATE_INDEX_QK, "5d"], [
      { updatedAt: start, updatedAtDate: new Date(start), id: `avg-${start}`, hashrateEhS: 0 },
    ]);

    request.mockResolvedValue({
      btcUsdCandles: [
        { id: `avg-${start}`, sum: String(60_000 * PRICE_SCALE), count: "1", timestamp: micros(start) },
      ],
      networkHashrate7DCandles: [
        { id: `avg-${start}`, sum: String(900 * 10 ** 18), count: "1", timestamp: micros(start) },
      ],
    });

    await fetchOracleOverlay(qc, "5d", ["btc", "networkHashrate"]);

    expect(qc.getQueryData<{ price: number }[]>([BTC_PRICE_INDEX_QK, "5d"])?.[0].price).toBe(60_000);
    expect(
      qc.getQueryData<{ hashrateEhS: number }[]>([NETWORK_HASHRATE_INDEX_QK, "5d"])?.[0].hashrateEhS,
    ).toBe(900);
  });

  it("opens a new bar when the clock rolls into one", async () => {
    const previous = start - 3_600_000;
    qc.setQueryData([HASHPRICE_CHART_QK, "5d"], {
      line: [
        {
          updatedAt: previous,
          updatedAtDate: new Date(previous),
          id: `avg-${previous}`,
          priceToken: 37,
        },
      ],
      candles: [],
    });

    request.mockResolvedValue({
      hashpriceUsdCandles: [
        {
          id: `avg-${start}`,
          sum: String(39 * PRICE_SCALE),
          count: "1",
          timestamp: micros(start),
          open: String(39 * PRICE_SCALE),
          high: String(39 * PRICE_SCALE),
          low: String(39 * PRICE_SCALE),
          close: String(39 * PRICE_SCALE),
        },
      ],
    });

    await fetchOracleOverlay(qc, "5d", ["hashprice"]);

    const data = qc.getQueryData<{
      line: { updatedAt: number; priceToken: number }[];
    }>([HASHPRICE_CHART_QK, "5d"]);

    // The new hour goes in front, and the one it succeeded keeps the value the
    // last poll of that hour left it with.
    expect(data?.line).toHaveLength(2);
    expect(data?.line[0]).toMatchObject({ updatedAt: start, priceToken: 39 });
    expect(data?.line[1]).toMatchObject({ updatedAt: previous, priceToken: 37 });
  });
});
