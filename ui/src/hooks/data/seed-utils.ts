import { SEED_LATEST_TIMESTAMPS } from "../../seed/meta";

/** 30 days in microseconds — seed bundles older than this are never loaded. */
const THIRTY_DAYS_MICROS = 30n * 24n * 60n * 60n * 1_000_000n;

export function isSeedFresh(latestMicros: number): boolean {
  const nowMicros = BigInt(Date.now()) * 1000n;
  return BigInt(latestMicros) >= nowMicros - THIRTY_DAYS_MICROS;
}

/**
 * Merge two arrays by deduplicating on `id`, preferring primary over seed.
 * Iterates each array separately — no intermediate spread copy.
 */
function mergeById<T extends { id: string | number }>(primary: T[], seed: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of primary) {
    seen.add(String(item.id));
    result.push(item);
  }
  for (const item of seed) {
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Returns true when the subgraph already returned data reaching back to (or
 * past) the window start — seed merge can be skipped entirely.
 *
 * Items are expected to be sorted by timestamp descending, so the **last**
 * entry is the oldest.
 */
function subgraphCoversWindow<T extends { timestamp: string }>(
  items: T[],
  windowStartMicros: bigint,
): boolean {
  if (items.length === 0) return false;
  return BigInt(items[items.length - 1].timestamp) <= windowStartMicros;
}

/**
 * Start loading a seed bundle in the background (returns undefined when stale).
 * Call before subgraph pagination so both run concurrently.
 */
export function prefetchSeed<T>(
  seedKey: keyof typeof SEED_LATEST_TIMESTAMPS,
  loader: () => Promise<T>,
): Promise<T> | undefined {
  return isSeedFresh(SEED_LATEST_TIMESTAMPS[seedKey]) ? loader() : undefined;
}

/**
 * Merge seed data into subgraph results when the subgraph doesn't yet cover the
 * full window.  Returns `primary` unchanged when the seed is stale, the
 * subgraph already covers the window, or no seed entries fall within range.
 *
 * Usage in each fetch function:
 *
 *   const seedPromise = prefetchSeed("btcUsds", loadBtcUsdsSeed);
 *   let all = await paginateSubgraph(...);
 *   all = await withSeedFallback(all, seedPromise, windowStartMicros);
 */
export async function withSeedFallback<T extends { id: string | number; timestamp: string }>(
  primary: T[],
  seedPromise: Promise<{ id: string | number; timestamp: string }[]> | undefined,
  windowStartMicros: bigint,
): Promise<T[]> {
  if (!seedPromise || subgraphCoversWindow(primary, windowStartMicros)) {
    return primary;
  }
  const seed = await seedPromise;
  const seedForRange = seed.filter((item) => BigInt(item.timestamp) >= windowStartMicros);
  return seedForRange.length > 0 ? mergeById(primary, seedForRange as T[]) : primary;
}
