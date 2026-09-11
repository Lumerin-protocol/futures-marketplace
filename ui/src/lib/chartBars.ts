export type ChartRange = "1d" | "5d" | "1m";

/** Chart range keys; kept as `TimePeriod` at the hook boundary. */
export type TimePeriod = ChartRange;

export const CHART_RANGES: readonly ChartRange[] = ["1d", "5d", "1m"];

export const CHART_RANGE_LABELS: Record<ChartRange, string> = {
  "1d": "1D",
  "5d": "5D",
  "1m": "1M",
};

export const CHART_RANGE_INTERVAL_LABELS: Record<ChartRange, string> = {
  "1d": "15-minute intervals",
  "5d": "hourly intervals",
  "1m": "12-hour intervals",
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type ChartRangeSpec = {
  intervalMs: number;
  windowMs: number;
  /** `tick` is one page of raw points (1D only). Wider ranges use Goldsky `hour`. */
  source: "tick" | "hour";
};

/**
 * 1D is 15m from ticks (one Goldsky page). 5D/1M use hourly aggregations so we
 * do not page thousands of ticks and 429. 1M is rolled to 12h so a month is not
 * 744 hourly candles.
 */
export const chartRangeSpec = (range: ChartRange): ChartRangeSpec => {
  switch (range) {
    case "1d":
      return { intervalMs: 15 * MINUTE_MS, windowMs: DAY_MS, source: "tick" };
    case "5d":
      return { intervalMs: HOUR_MS, windowMs: 5 * DAY_MS, source: "hour" };
    case "1m":
      return { intervalMs: 12 * HOUR_MS, windowMs: 31 * DAY_MS, source: "hour" };
  }
};

export const alignBucketStart = (timeMs: number, intervalMs: number): number =>
  Math.floor(timeMs / intervalMs) * intervalMs;

export const startMicrosForRange = (range: ChartRange): string => {
  const startMs = Date.now() - chartRangeSpec(range).windowMs;
  return Math.floor(startMs * 1000).toString();
};

export type AverageTick = {
  id: string;
  timeMs: number;
  sum: number;
  count: number;
};

/** Merge sum/count samples into coarser buckets. Newest-first. */
export const rollupAverageTicks = (
  rows: AverageTick[],
  intervalMs: number
): AverageTick[] => {
  const groups = new Map<number, { sum: number; count: number }>();
  for (const row of rows) {
    if (
      !Number.isFinite(row.timeMs) ||
      !Number.isFinite(row.sum) ||
      row.count <= 0
    )
      continue;
    const bucket = alignBucketStart(row.timeMs, intervalMs);
    const prev = groups.get(bucket);
    if (prev) {
      prev.sum += row.sum;
      prev.count += row.count;
    } else {
      groups.set(bucket, { sum: row.sum, count: row.count });
    }
  }
  return [...groups.entries()]
    .map(([timeMs, { sum, count }]) => ({
      id: `avg-${timeMs}`,
      timeMs,
      sum,
      count,
    }))
    .sort((a, b) => b.timeMs - a.timeMs);
};
