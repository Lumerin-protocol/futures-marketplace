import type { NotifyOnChangeProps } from "@tanstack/react-query";
import { subgraphRetryOptions } from "../subgraphRetry";

/**
 * One tick drives every indexer read for a venue.
 *
 * Faster than the 15s the individual polls used, and still cheaper: Goldsky's
 * limit counts requests (50 per 10s, endpoint-wide), and one batched request per
 * venue per 5s is roughly half what the ~10 separate 15s polls cost. Base seals
 * blocks every 2s, so 5s is about as fresh as is useful without spending
 * requests on ticks that cannot contain new data.
 */
export const SNAPSHOT_TICK_MS = 5_000;

/**
 * Applied to the individual hooks the snapshot feeds.
 *
 * They keep their own query functions so they stay independently fetchable —
 * explicit `invalidateQueries` / `refetchQueries` still work, and a hook mounted
 * on a page without a snapshot driver falls back to fetching for itself. What
 * they lose is any schedule of their own: no interval, and no refetch on mount
 * or focus while the snapshot is keeping them current. Without this a window
 * focus would fire the whole fan-out at once, which is the burst this refactor
 * exists to remove.
 */
export const snapshotFedQueryOptions = {
  ...subgraphRetryOptions,
  staleTime: SNAPSHOT_TICK_MS * 2,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
} as const;

/**
 * Applied to the snapshot drivers themselves.
 *
 * `notifyOnChangeProps: []` is the important one. A snapshot is a side effect,
 * not a data source — its value goes into other caches, and its own result
 * carries a block number that changes every tick. Without this the component
 * hosting the driver would re-render on every tick regardless of whether any
 * data changed, which is the cost this refactor is trying to remove.
 *
 * Background polling stays off so a hidden tab spends no requests at all.
 */
export const snapshotQueryOptions = {
  ...subgraphRetryOptions,
  notifyOnChangeProps: [] as NotifyOnChangeProps,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
};
