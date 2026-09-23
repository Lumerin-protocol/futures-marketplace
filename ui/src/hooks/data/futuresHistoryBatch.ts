import { graphqlRequest } from "./graphql";
import { FuturesHistoryFirstPageQuery } from "./queries/futures";

/** The three futures history tables, each on its newest page. */
type FuturesHistoryFirstPage = {
  historyOrders: unknown[];
  historyPositions: unknown[];
  historyTrades: unknown[];
};

export type FuturesHistoryTable = keyof FuturesHistoryFirstPage;

const inFlight = new Map<string, Promise<FuturesHistoryFirstPage>>();

/**
 * The newest page of one futures history table, sharing a request with the other
 * two whenever they ask at the same time.
 *
 * All three mount together in `OrdersPositionsTabWidget` and ask with identical
 * variables, so on a cold load — and again after every transaction, when
 * `refreshVenueViews` resets all three — this collapses three requests into one.
 * Only page 0 is shared: past that the user is scrolling a single table, and the
 * others would be paying for pages nobody asked for.
 */
export const fetchFuturesHistoryFirstPage = async (
  table: FuturesHistoryTable,
  address: string,
  pageSize: number,
): Promise<unknown[]> => {
  const key = `${address}|${pageSize}`;
  const existing = inFlight.get(key);

  const pending =
    existing ??
    graphqlRequest<FuturesHistoryFirstPage>(FuturesHistoryFirstPageQuery, {
      address,
      historyFirst: pageSize,
      historySkip: 0,
    }).finally(() => {
      inFlight.delete(key);
    });

  if (!existing) inFlight.set(key, pending);

  return (await pending)[table] ?? [];
};

/**
 * Stop new callers from joining the history request currently in flight.
 *
 * Called from `refreshVenueViews` for the same reason the snapshot registry has
 * its own version: a request issued before the transaction was indexed would
 * hand back pre-transaction rows to a refetch that exists to show the new ones.
 */
export const dropInFlightFuturesHistory = (): void => {
  inFlight.clear();
};
