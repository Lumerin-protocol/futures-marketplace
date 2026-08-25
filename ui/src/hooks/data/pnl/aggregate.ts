import type { PnlVenueId } from "./venues";

/** A per-venue figure summed across the account's venues. */
export interface VenuePnlAggregate {
  /** Sum over every venue, or `null` while the account's total is not yet known. */
  total: bigint | null;
  /** Nothing to show yet and a read is in flight. */
  isLoading: boolean;
  /** A total is on screen and a background read is refreshing it. */
  isRefreshing: boolean;
  perVenue: Partial<Record<PnlVenueId, bigint>>;
}

interface VenueResult {
  data: bigint | undefined;
  isError: boolean;
  isFetching: boolean;
}

/**
 * Folds per-venue reads into one account-wide figure.
 *
 * A venue still in flight holds the total back, so a half-loaded sum is never
 * painted as if it were the account's. A venue whose read failed is left out
 * instead — one unreachable subgraph should degrade the header, not blank it.
 */
export function aggregateVenuePnl(
  results: readonly VenueResult[],
  venueIds: readonly PnlVenueId[],
): VenuePnlAggregate {
  const perVenue: Partial<Record<PnlVenueId, bigint>> = {};
  let sum = 0n;
  let reported = 0;
  let pending = false;

  results.forEach((result, index) => {
    if (result.data !== undefined) {
      perVenue[venueIds[index]] = result.data;
      sum += result.data;
      reported += 1;
      return;
    }
    if (!result.isError) pending = true;
  });

  const total = pending || reported === 0 ? null : sum;
  const isFetching = results.some((result) => result.isFetching);

  return {
    total,
    isLoading: total === null && isFetching,
    isRefreshing: total !== null && isFetching,
    perVenue,
  };
}
