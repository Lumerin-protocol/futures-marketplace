import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { runSnapshotOnce, type SnapshotVenue } from "./driverRegistry";

/**
 * Raised when the venue snapshot failed, so this read has no value to return.
 *
 * Carries no HTTP status of its own, which is what keeps `subgraphRetryOptions`
 * from retrying: retrying here would start yet another snapshot, and the driver
 * is already going to run one on its next tick.
 */
export class SnapshotUnavailableError extends Error {
  readonly reason: unknown;

  constructor(venue: SnapshotVenue, reason: unknown) {
    super(`The ${venue} snapshot failed; waiting for the next tick`);
    this.name = "SnapshotUnavailableError";
    this.reason = reason;
  }
}

/**
 * Resolve a snapshot-fed cache entry, letting the venue snapshot do the fetching.
 *
 * Every hook that shares a venue funnels through one coalesced snapshot request,
 * which is what keeps a cold page load from firing twenty-odd parallel queries
 * and tripping the indexer's rate limit.
 *
 * `fallback` runs only when the snapshot succeeded without supplying this slice,
 * or when no driver is mounted at all. A *failed* snapshot deliberately does not
 * reach it: the failure is almost always the rate limit, and having a dozen
 * hooks each retry on their own is what tripped it. The driver keeps polling
 * and writes these entries directly when it recovers, so an errored read heals
 * within one tick without anyone fetching.
 */
export const readViaSnapshot = async <T>(
  qc: QueryClient,
  venue: SnapshotVenue,
  key: QueryKey,
  fallback: () => Promise<T>,
): Promise<T> => {
  // Forced: this hook's cache is empty, so the driver has to include the group
  // this key belongs to even if its interval says it is not due yet.
  const pending = runSnapshotOnce(venue, true);

  if (pending) {
    try {
      await pending;
    } catch (error) {
      throw new SnapshotUnavailableError(venue, error);
    }
    const cached = qc.getQueryData<T>(key);
    if (cached !== undefined) return cached;
  }

  return fallback();
};
