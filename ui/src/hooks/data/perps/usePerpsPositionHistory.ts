import { UserClosedPositionSessionsQuery } from "../queries/perps";
import { sessionIsLong } from "../../../lib/positionDirection";
import type { PositionSession } from "./useUserPositionSessions";
import {
  usePaginatedHistory,
  type PaginatedHistoryResult,
} from "../usePaginatedHistory";

export const PERPS_POSITION_HISTORY_QK = "PerpsPositionHistory";

type RawPositionSession = {
  closePrice: string | null;
  entryPrice: string;
  closedQuantity: string;
  liquidatedQuantity: string;
  fundingFees: string;
  id: string;
  lastTradeAt: string;
  maxQuantity: string;
  netQuantity: string;
  openedAt: string;
  realizedPnl: string;
  status: string;
  tradingFees: string;
  user: {
    id: string;
  };
  /// One fill, for `sessionIsLong`.
  lastFill: { netQuantityAfter: string; tradeQuantity: string }[];
};

type Response = {
  historyPositions: RawPositionSession[];
};

const mapSession = (session: RawPositionSession): PositionSession => ({
  closePrice: session.closePrice ? BigInt(session.closePrice) : null,
  entryPrice: BigInt(session.entryPrice),
  closedQuantity: BigInt(session.closedQuantity),
  liquidatedQuantity: BigInt(session.liquidatedQuantity),
  fundingFees: BigInt(session.fundingFees),
  id: session.id,
  lastTradeAt: session.lastTradeAt,
  maxQuantity: BigInt(session.maxQuantity),
  netQuantity: BigInt(session.netQuantity),
  openedAt: session.openedAt,
  realizedPnl: BigInt(session.realizedPnl),
  status: session.status,
  tradingFees: BigInt(session.tradingFees),
  user: {
    id: session.user.id,
  },
  isLong: sessionIsLong(session.netQuantity, session.lastFill[0]),
});

/// Paginated ("Load More") view of a user's closed Perps position sessions.
/// The open Positions tab keeps using `useUserPositionSessions` (all sessions);
/// this hook only fetches CLOSE sessions, newest-first, one page at a time.
export const usePerpsPositionHistory = (
  address: `0x${string}` | undefined,
  enabled: boolean = true,
): PaginatedHistoryResult<PositionSession> => {
  return usePaginatedHistory<Response, PositionSession>({
    queryKey: [PERPS_POSITION_HISTORY_QK, address],
    query: UserClosedPositionSessionsQuery,
    variables: { address },
    subgraphUrl: process.env.REACT_APP_SUBGRAPH_PERPS_URL,
    selectRows: (response) => response.historyPositions,
    mapRow: mapSession,
    getId: (session) => session.id,
    enabled: !!address && enabled,
  });
};
