import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { GetResponse } from "../../../gateway/interfaces";

/**
 * Structural equality for freshly-mapped subgraph rows.
 *
 * Hand-rolled rather than `JSON.stringify`, which throws on the `bigint` values
 * these shapes are full of. Only ever handed plain objects, arrays and
 * primitives, so it does not handle cycles, Maps/Sets or class instances.
 */
export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const aArr = a as unknown[];
    const bArr = b as unknown[];
    return aArr.length === bArr.length && aArr.every((item, i) => isDeepEqual(item, bArr[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  if (aKeys.length !== Object.keys(bObj).length) return false;
  return aKeys.every((key) => key in bObj && isDeepEqual(aObj[key], bObj[key]));
}

/**
 * True when something wrote this entry after `startedAt`.
 *
 * A snapshot is in flight for a few hundred milliseconds, and a transaction
 * confirming in that window invalidates the affected entries (see
 * `refreshVenueViews`), which refetches them at a later block. The snapshot
 * response then lands holding pre-transaction rows. Without this check it would
 * overwrite the fresher data and the user would watch their own order vanish
 * until the next tick.
 */
function supersededSince(qc: QueryClient, key: QueryKey, startedAt: number): boolean {
  const updatedAt = qc.getQueryState(key)?.dataUpdatedAt;
  return updatedAt !== undefined && updatedAt > startedAt;
}

/**
 * Write a cache entry only when its value actually changed.
 *
 * The venue snapshot rewrites every entry it owns on every tick. Without this
 * guard each tick would hand every subscriber a new object identity and
 * re-render the whole page on a 5s timer, which is worse than the per-query
 * polling it replaces.
 *
 * `startedAt` is when the snapshot request was issued, used to avoid clobbering
 * an entry that was refreshed while it was in flight.
 */
export function writeIfChanged<T>(
  qc: QueryClient,
  key: QueryKey,
  next: T,
  startedAt: number,
): void {
  if (supersededSince(qc, key, startedAt)) return;
  const prev = qc.getQueryData<T>(key);
  if (prev !== undefined && isDeepEqual(prev, next)) return;
  qc.setQueryData(key, next);
}

/**
 * Same, for the `GetResponse<T>` wrapper, comparing only the `data` payload.
 *
 * `blockNumber` is excluded deliberately: it advances every ~2s with Base's
 * block time whether or not any data changed, so comparing it would defeat the
 * guard entirely. The trade-off is that an unchanged entry keeps an older
 * `blockNumber`, which is safe only because the post-transaction waiter reads
 * the indexed head from the snapshot's own result rather than from these
 * entries. See `waitForSnapshotBlockNumber`.
 */
export function writeResponseIfChanged<T>(
  qc: QueryClient,
  key: QueryKey,
  data: T,
  blockNumber: number,
  startedAt: number,
): void {
  if (supersededSince(qc, key, startedAt)) return;
  const prev = qc.getQueryData<GetResponse<T>>(key);
  if (prev !== undefined && isDeepEqual(prev.data, data)) return;
  qc.setQueryData<GetResponse<T>>(key, { data, blockNumber });
}
