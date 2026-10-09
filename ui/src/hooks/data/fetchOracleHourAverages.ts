import { subgraphTimestampToMs } from "../../lib/chartCandles";
import type { SubgraphHashpriceCandle } from "../../lib/chartCandles";
import type { AverageTick } from "../../lib/chartBars";
import { OracleHourCandlesQuery } from "./queries/oracles";
import { requestOracleAggregation } from "./oracleCurrentBucket";

/** One page covers a month of hourly bars (744). */
const HOUR_PAGE_SIZE = 1000;

/** An hour bar in the subgraph's microsecond timestamps. */
const HOUR_MICROS = 3_600_000_000n;

export type HourAggRow = {
  id: string | number;
  sum: string;
  count: string;
  timestamp: string;
};

/** The hashprice series carries OHLC on top of the shared sum/count. */
export type HourOhlcRow = SubgraphHashpriceCandle & HourAggRow;

export type OracleHourCandles = {
  hashpriceUsdCandles: HourOhlcRow[];
  btcUsdCandles: HourAggRow[];
  networkHashrate7DCandles: HourAggRow[];
};

const inFlight = new Map<string, Promise<OracleHourCandles>>();

/**
 * Fetch every hourly oracle series at once, coalescing the charts that ask for
 * the same range into a single request.
 *
 * The three charts mount together and each computes its own `Date.now()`, so
 * their start timestamps differ by a millisecond or two — enough to miss each
 * other entirely if this keyed on the raw value. Flooring to the hour they
 * already bucket by gives them one key, and over-fetching by up to an hour costs
 * nothing: every caller filters the rows against its own start.
 *
 * Callers keep their own react-query entries, so a refetch still resolves to the
 * same cache key it did before; all that is shared is the request itself.
 */
export const fetchOracleHourCandles = (startMicros: string): Promise<OracleHourCandles> => {
  const from = ((BigInt(startMicros) / HOUR_MICROS) * HOUR_MICROS).toString();

  const existing = inFlight.get(from);
  if (existing) return existing;

  const pending = requestOracleAggregation<OracleHourCandles>(OracleHourCandlesQuery, {
    interval: "hour",
    first: HOUR_PAGE_SIZE,
    startTimestamp: from,
  }).finally(() => {
    inFlight.delete(from);
  });

  inFlight.set(from, pending);
  return pending;
};

export const hourAggToAverageTick = (row: HourAggRow): AverageTick => ({
  id: String(row.id),
  timeMs: subgraphTimestampToMs(row.timestamp),
  sum: Number(row.sum),
  count: Number(row.count),
});

/**
 * One raw oracle tick as a sample to average.
 *
 * `value` is the series' own field: a price for hashprice and BTC, hashes per
 * second for network hashrate.
 *
 * A non-positive reading is the oracle not having posted rather than a real
 * measurement — none of these series can legitimately be zero — so it is given a
 * count of zero and `rollupAverageTicks` drops it. That covers a missing field
 * and an unparseable one too, since neither is greater than zero.
 *
 * Shared by the three charts and by the overlay that keeps their newest bar
 * current, so that a bar cannot change value simply because the range behind it
 * refetched.
 */
export const oracleTickToAverage = (
  row: { id: string | number; timestamp: string },
  value: string | null | undefined,
): AverageTick => ({
  id: String(row.id),
  timeMs: subgraphTimestampToMs(row.timestamp),
  sum: Number(value),
  count: Number(value) > 0 ? 1 : 0,
});

/** One series out of the shared hour batch, trimmed to this caller's range. */
export async function fetchOracleHourAggRows(
  field: "btcUsdCandles" | "networkHashrate7DCandles",
  startMicros: string,
): Promise<HourAggRow[]> {
  const req = await fetchOracleHourCandles(startMicros);
  const start = BigInt(startMicros);
  return (req[field] ?? []).filter((row) => BigInt(row.timestamp) >= start);
}
