export const backgroundRefetchOpts = {
  refetchInterval: 15000, // 15 seconds
  refetchOnMount: false,
};

/**
 * How long a fetched oracle index range stays fresh, keyed by the chart's time
 * period. Without this react-query treats every result as immediately stale and
 * revalidates on each period switch, so returning to an already loaded range
 * flashes a refetch even though the points are served straight from the cache.
 * Wider ranges are server-side aggregates that barely move, hence the longer
 * windows.
 */
export const indexStaleTimeMs: Record<"day" | "week" | "month", number> = {
  day: 60 * 1000,
  week: 5 * 60 * 1000,
  month: 30 * 60 * 1000,
};

/** Keeps a range around long enough to survive browsing between periods. */
export const indexGcTimeMs = 60 * 60 * 1000;
