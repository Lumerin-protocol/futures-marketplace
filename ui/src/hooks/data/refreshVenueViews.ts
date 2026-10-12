import type { QueryClient } from "@tanstack/react-query";
import type { ContractMode } from "../../types/types";
import { getOrderBookQueryKey } from "./orderBookHelpers";
import { dropInFlightFuturesHistory } from "./futuresHistoryBatch";
import { dropInFlightSnapshot } from "./snapshot/driverRegistry";
import { expireVenueGroups } from "./snapshot/groupSchedule";
import { invalidatePortfolioPnl } from "./pnl/invalidate";
import { PARTICIPANT_QK } from "./getUserFuturesOrders";
import { POSITION_BOOK_QK } from "./getUserFuturesPositions";
import { HISTORICAL_ORDERS_QK } from "./useHistoricalOrders";
import { FUTURES_POSITION_HISTORY_QK } from "./useFuturesPositionHistory";
import { USER_FUTURES_TRADES_QK } from "./useUserFuturesTrades";
import { USER_PERPS_ORDERS_QK } from "./perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "./perps/useUserPositionSessions";
import { PERPS_ORDER_HISTORY_QK } from "./perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "./perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "./perps/useUserTrades";

/**
 * Reset one venue's paginated histories (orders, positions, trades) back to
 * their newest page. The histories are never polled (see `usePaginatedHistory`),
 * so this is the only way new rows reach them; a reset rather than an
 * invalidation so the user lands on page one instead of having new rows merged
 * into whatever pages were already loaded.
 *
 * Called after the account's own transactions (`refreshVenueViews`) and by the
 * venue snapshot when it sees the account's orders or positions change between
 * ticks without one — a resting order filled by someone else's taker, a
 * liquidation, a settlement by a keeper. Those used to be caught by a 15s poll
 * on the open Trades tab; this is the event that poll was waiting for.
 */
export function resetVenueHistory(qc: QueryClient, contractMode: ContractMode, address: `0x${string}`) {
  if (contractMode === "perpetual") {
    return Promise.all([
      qc.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, address] }),
      qc.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, address] }),
      qc.resetQueries({ queryKey: [USER_TRADES_QK, address] }),
    ]);
  }
  // The three futures tables share a batched first page; a batch already in
  // flight predates whatever changed, so the resets must not join it.
  dropInFlightFuturesHistory();
  return Promise.all([
    qc.resetQueries({ queryKey: [HISTORICAL_ORDERS_QK, address] }),
    qc.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, address] }),
    qc.resetQueries({ queryKey: [USER_FUTURES_TRADES_QK, address] }),
  ]);
}

/**
 * After a transaction that touched the user's orders or positions on one
 * venue: refetch the live views and reset the paginated histories back to
 * their newest page, so new rows appear at the top rather than being merged
 * into a stale page.
 */
export async function refreshVenueViews(qc: QueryClient, contractMode: ContractMode, address?: `0x${string}`) {
  // The invalidations below all resolve through the venue snapshot, so they
  // coalesce into a single request. Detach any snapshot already in flight first:
  // it was started before this transaction was indexed, so joining it would
  // serve pre-transaction data.
  dropInFlightSnapshot(contractMode);
  // The invalidated hooks read back through the driver, which would otherwise
  // decide their group was not due yet and hand back a document without them —
  // sending each off to fetch alone.
  expireVenueGroups(contractMode);

  await Promise.all([
    qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
    invalidatePortfolioPnl(qc),
    ...(address
      ? [
          resetVenueHistory(qc, contractMode, address),
          ...(contractMode === "perpetual"
            ? [
                qc.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, address] }),
                qc.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, address] }),
              ]
            : [
                qc.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
                qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
              ]),
        ]
      : []),
  ]);
}
