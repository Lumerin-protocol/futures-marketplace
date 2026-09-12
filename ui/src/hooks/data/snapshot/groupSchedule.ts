import type { QueryGroup } from "../queries/slice";
import { SNAPSHOT_TICK_MS } from "./config";
import type { SnapshotVenue } from "./driverRegistry";

/**
 * Which groups a venue should ask for on this tick.
 *
 * The groups are a caching policy, not a request boundary: everything due on the
 * same tick goes out as one document. What the grouping buys is that a slice
 * whose value cannot have changed stops being asked for — the constants are
 * fetched once instead of 720 times an hour, and the market data of the venue
 * nobody is looking at is not fetched at all.
 */
export type TickGroup = Exclude<QueryGroup, "history">;

/**
 * How often each group is worth re-reading.
 *
 * Account and market are deliberately the same, so in the common case one tick
 * carries both and costs one request. Splitting them is a one-line change here
 * if the account data ever turns out not to need this cadence.
 */
const GROUP_INTERVAL_MS: Record<Exclude<TickGroup, "constants">, number> = {
  account: SNAPSHOT_TICK_MS,
  market: SNAPSHOT_TICK_MS,
};

/**
 * How early a tick may fire and still count as a full interval having passed.
 *
 * The intervals above are equal to the tick, so without slack a timer firing a
 * millisecond early would find nothing due, skip the request entirely, and wait
 * another whole tick — halving the refresh rate at random.
 */
const TIMER_SLACK_MS = 500;

/** When each (venue, group) pair last went out. */
const lastRequested = new Map<string, number>();

const stamp = (venue: SnapshotVenue, group: TickGroup) => `${venue}:${group}`;

export type TickContext = {
  /** Account slices are omitted entirely when there is no wallet. */
  hasAddress: boolean;
  /** Market slices are omitted for the venue that is not on screen. */
  isActiveVenue: boolean;
  /**
   * Ignore the intervals and ask for everything applicable. Used when a hook
   * fetches through the driver with a cold cache, and after a transaction.
   */
  force?: boolean;
};

export const dueGroups = (
  venue: SnapshotVenue,
  { hasAddress, isActiveVenue, force = false }: TickContext,
  now: number = Date.now(),
): TickGroup[] => {
  const due: TickGroup[] = [];

  const neverRequested = (group: TickGroup) => !lastRequested.has(stamp(venue, group));
  const elapsed = (group: TickGroup, interval: number) =>
    neverRequested(group) || now - (lastRequested.get(stamp(venue, group)) ?? 0) >= interval - TIMER_SLACK_MS;

  // Constants have no interval, so `force` — which is about ignoring intervals —
  // does not apply to them. Once fetched they are kept until reload.
  if (neverRequested("constants")) due.push("constants");
  if (hasAddress && (force || elapsed("account", GROUP_INTERVAL_MS.account))) due.push("account");
  if (isActiveVenue && (force || elapsed("market", GROUP_INTERVAL_MS.market))) due.push("market");

  return due;
};

/**
 * Record that these groups went out, so their interval starts now.
 *
 * Called before awaiting the response rather than after: two callers arriving
 * within one tick should not both decide the same group is due.
 */
export const markRequested = (
  venue: SnapshotVenue,
  groups: readonly TickGroup[],
  now: number = Date.now(),
): void => {
  for (const group of groups) lastRequested.set(stamp(venue, group), now);
};

/**
 * Undo `markRequested`, for a request that did not arrive.
 *
 * The mark goes on before the request is awaited, so that two callers in the
 * same tick cannot both decide a group is due. That makes a failure look like a
 * success to the next tick, which for the constants would mean never asking
 * again — they have no interval to come round on.
 */
const unmarkRequested = (venue: SnapshotVenue, groups: readonly TickGroup[]): void => {
  for (const group of groups) lastRequested.delete(stamp(venue, group));
};

/** Run a tick's request, holding its groups to their interval only if it lands. */
export const onTheSchedule = async <T>(
  venue: SnapshotVenue,
  groups: readonly TickGroup[],
  at: number,
  request: () => Promise<T>,
): Promise<T> => {
  markRequested(venue, groups, at);
  try {
    return await request();
  } catch (error) {
    unmarkRequested(venue, groups);
    throw error;
  }
};

/**
 * Make everything due again for a venue, short of the constants.
 *
 * Called after a confirmed transaction: the entity caches are about to be
 * invalidated, and their refetch reads back through the driver. Without this the
 * driver could decide nothing was due yet and hand back a document with none of
 * the slices those hooks are waiting for, sending each of them off to fetch
 * alone — the burst the driver exists to prevent.
 */
export const expireVenueGroups = (venue: SnapshotVenue): void => {
  lastRequested.delete(stamp(venue, "account"));
  lastRequested.delete(stamp(venue, "market"));
};

/** Test seam. */
export const resetGroupSchedule = (): void => {
  lastRequested.clear();
};
