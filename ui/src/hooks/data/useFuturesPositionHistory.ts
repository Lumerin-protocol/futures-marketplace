import { HistoricalPositionsQuery } from "./graphql-queries";
import {
  sessionToHistoricalPosition,
  type HistoricalPosition,
  type HistoricalPositionsResponse,
} from "./useHistoricalPositions";
import { usePaginatedHistory, type PaginatedHistoryResult } from "./usePaginatedHistory";

export const FUTURES_POSITION_HISTORY_QK = "FuturesPositionHistory";

/// Paginated ("Load More") view of a user's closed Futures position sessions.
/// Reuses the same query + mapping as the aggregate `useHistoricalPositions`
/// hook (which still feeds the realized-PnL header) but pages incrementally
/// instead of fetching every session up front.
export const useFuturesPositionHistory = (
  address: `0x${string}` | undefined,
  enabled: boolean = false,
): PaginatedHistoryResult<HistoricalPosition> => {
  return usePaginatedHistory<HistoricalPositionsResponse, HistoricalPosition>({
    queryKey: [FUTURES_POSITION_HISTORY_QK, address],
    query: HistoricalPositionsQuery,
    variables: { address: address?.toLowerCase() },
    selectRows: (response) => response.positionSessions,
    mapRow: sessionToHistoricalPosition,
    getId: (position) => position.id,
    enabled: !!address && enabled,
  });
};
