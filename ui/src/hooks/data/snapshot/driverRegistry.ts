export type SnapshotVenue = "futures" | "perpetual";

/**
 * `force` asks for every group that applies, ignoring the intervals in
 * `groupSchedule`. A scheduled tick passes false and takes only what is due; a
 * hook reading through with an empty cache passes true, because the slice it is
 * waiting for has to be in the response or it will go and fetch it alone.
 */
type SnapshotRunner = (force: boolean) => Promise<unknown>;

/**
 * The mounted snapshot driver for each venue, if any.
 *
 * Registered during the driver's render rather than in an effect, and that
 * ordering is the whole point: React renders parents before children, but runs
 * effects children-first. The drivers live at the top of the Futures page while
 * the hooks that depend on them sit in child widgets, so registering in an
 * effect would let a child's first fetch start before the parent had registered
 * and send it down the fallback path — which is the redundant request this
 * module exists to remove.
 */
const runners = new Map<SnapshotVenue, SnapshotRunner>();

/** In-flight snapshot per venue, so concurrent callers share one request. */
const inFlight = new Map<SnapshotVenue, Promise<unknown>>();

export const setSnapshotRunner = (venue: SnapshotVenue, run: SnapshotRunner): void => {
  runners.set(venue, run);
};

export const clearSnapshotRunner = (venue: SnapshotVenue): void => {
  runners.delete(venue);
};

export const hasSnapshotDriver = (venue: SnapshotVenue): boolean => runners.has(venue);

/**
 * Fetch the venue snapshot, coalescing concurrent callers into one request.
 *
 * Returns `null` when no driver is mounted, which tells the caller to fetch for
 * itself. Both the driver's own query and every snapshot-fed hook go through
 * here, so a cold page load costs one request per venue instead of one per hook:
 * a snapshot writes every entity cache entry anyway, and a mounting query with
 * an empty cache would otherwise always fetch, `refetchOnMount: false` or not.
 */
export const runSnapshotOnce = (
  venue: SnapshotVenue,
  force: boolean = false,
): Promise<unknown> | null => {
  const run = runners.get(venue);
  if (!run) return null;

  // A request already in flight is joined whatever it was asked for. If it turns
  // out not to carry the joiner's slice, that hook falls back to fetching for
  // itself — one request, versus the stampede of waiting on a second snapshot.
  const existing = inFlight.get(venue);
  if (existing) return existing;

  const pending = run(force).finally(() => {
    inFlight.delete(venue);
  });
  inFlight.set(venue, pending);

  return pending;
};

/**
 * Stop new callers from joining the snapshot currently in flight for a venue.
 *
 * Called after a transaction is confirmed and indexed: a snapshot that started
 * before that point cannot contain the new state, and the entity queries about
 * to be invalidated would otherwise coalesce onto it and show pre-transaction
 * data until the next tick. The abandoned request still completes, but
 * `writeIfChanged`'s `startedAt` guard discards its writes if the fresh snapshot
 * has already landed.
 */
export const dropInFlightSnapshot = (venue: SnapshotVenue): void => {
  inFlight.delete(venue);
};

/** Test seam: drop all registrations and in-flight state. */
export const resetSnapshotRegistry = (): void => {
  runners.clear();
  inFlight.clear();
};
