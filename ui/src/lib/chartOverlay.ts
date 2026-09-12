import { alignBucketStart } from "./chartBars";

/**
 * Keeping the bar in progress live without re-reading the whole range.
 *
 * The index charts fetch a window — a day, five days, a month — and bucket it
 * into bars. Only the newest bar can still change, but its `staleTime` is a
 * whole bar interval, so a new oracle post could sit invisible for up to an
 * hour on 5D. Refetching the window on a short interval is not an option: a
 * month of hourly bars for the three series is ~274 KB, and at a 5s tick that is
 * ~197 MB an hour.
 *
 * So the bar in progress is fetched on its own — a few hundred bytes — and
 * spliced over the cached range by the functions here.
 */

export const currentBucketStartMs = (intervalMs: number, nowMs: number = Date.now()): number =>
  alignBucketStart(nowMs, intervalMs);

/** The line series key their bars by `updatedAt`; the candles by `timeMs`. */
export const byUpdatedAt = (point: { updatedAt: number }): number => point.updatedAt;
export const byTimeMs = (point: { timeMs: number }): number => point.timeMs;

/**
 * Replace every bar at or after `bucketStartMs` with freshly fetched ones.
 *
 * Replace rather than merge: the overlay recomputes the bar from its own read of
 * the source rows, so it is complete on its own and there is nothing to
 * reconcile. Bars are newest-first, which both the rollup and the chart rely on.
 *
 * Returns the original array when nothing would change, so the caller can skip
 * the cache write and not re-render the chart 720 times an hour for a bar that
 * has not moved.
 */
export const spliceNewestBuckets = <T>(
  cached: readonly T[],
  overlay: readonly T[],
  bucketStartMs: number,
  keyOf: (point: T) => number,
): readonly T[] => {
  const older = cached.filter((point) => keyOf(point) < bucketStartMs);

  // The overlay is authoritative from `bucketStartMs` on, including when it is
  // empty — a bar with no rows behind it should disappear, not linger.
  if (older.length === cached.length && overlay.length === 0) return cached;

  const merged = [...overlay, ...older];
  return sameBars(cached, merged) ? cached : merged;
};

/**
 * Whether two bar lists are interchangeable for rendering.
 *
 * Compares every own value, so a bar whose average moved by one satoshi counts
 * as a change while an identical refetch does not.
 */
const sameBars = <T>(a: readonly T[], b: readonly T[]): boolean => {
  if (a.length !== b.length) return false;

  return a.every((left, index) => {
    const right = b[index];
    const keys = Object.keys(left as object) as (keyof T)[];
    if (keys.length !== Object.keys(right as object).length) return false;

    return keys.every((key) => {
      const l = left[key];
      const r = right[key];
      // `updatedAtDate` is a fresh Date on every map; compare by value.
      if (l instanceof Date && r instanceof Date) return l.getTime() === r.getTime();
      return Object.is(l, r);
    });
  });
};
