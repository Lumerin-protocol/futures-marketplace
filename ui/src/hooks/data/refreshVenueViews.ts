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
import { FUNDING_RATE_QK } from "./perps/useFundingRate";
import { USER_PERPS_ORDERS_QK } from "./perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "./perps/useUserPositionSessions";
import { PERPS_ORDER_HISTORY_QK } from "./perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "./perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "./perps/useUserTrades";

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
  // Same reasoning for the shared first page of the futures history tables.
  dropInFlightFuturesHistory();
  // The invalidated hooks read back through the driver, which would otherwise
  // decide their group was not due yet and hand back a document without them —
  // sending each off to fetch alone.
  expireVenueGroups(contractMode);

  await Promise.all([
    qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
    invalidatePortfolioPnl(qc),
    // Trading settles funding, so the displayed rate is stale after a perps tx.
    ...(contractMode === "perpetual" ? [qc.invalidateQueries({ queryKey: [FUNDING_RATE_QK] })] : []),
    ...(address
      ? contractMode === "perpetual"
        ? [
            qc.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, address] }),
            qc.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, address] }),
            qc.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, address] }),
            qc.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, address] }),
            qc.resetQueries({ queryKey: [USER_TRADES_QK, address] }),
          ]
        : [
            qc.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
            qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
            qc.resetQueries({ queryKey: [HISTORICAL_ORDERS_QK, address] }),
            qc.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, address] }),
            qc.resetQueries({ queryKey: [USER_FUTURES_TRADES_QK, address] }),
          ]
      : []),
  ]);
}
