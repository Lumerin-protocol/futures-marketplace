import { graphqlRequest } from "../graphql";
import { sessionIsLong } from "../../../lib/positionDirection";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPositionSessionsQuery } from "../queries/perps";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";

export const USER_POSITION_SESSIONS_QK = "UserPositionSessions";

/// Also used by `usePerpsSnapshot`, which writes this entry from the same slice.
export const SESSION_PAGE_SIZE = 100;

/// Kept fresh by `usePerpsSnapshot`, which writes this cache entry directly.
export const useUserPositionSessions = (address: `0x${string}` | undefined) => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [USER_POSITION_SESSIONS_QK, address],
    queryFn: () => {
      if (!address) throw new Error("useUserPositionSessions: address is required");
      return readViaSnapshot(qc, "perpetual", [USER_POSITION_SESSIONS_QK, address], () =>
        fetchUserPositionSessionsAsync(address),
      );
    },
    enabled: !!address,
    ...snapshotFedQueryOptions,
  });

  return query;
};

const fetchUserPositionSessionsAsync = async (
  address: `0x${string}`,
) => {
  const variables = { address, sessionFirst: SESSION_PAGE_SIZE };

  const response = await graphqlRequest<UserPositionSessionsResponse>(
    UserPositionSessionsQuery,
    variables,
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  return mapUserPositionSessions(response.sessions);
};

/// Fed by the `sessions` slice, batched into a venue tick or fetched standalone.
export const mapUserPositionSessions = (
  rows: PositionSessionRow[],
): UserPositionSessions => ({
  positionSessions: rows.map((session) => ({
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
  })),
});

export type UserPositionSessions = {
  positionSessions: PositionSession[];
};

export type PositionSession = {
  closePrice: bigint | null;
  entryPrice: bigint;
  closedQuantity: bigint;
  liquidatedQuantity: bigint;
  fundingFees: bigint;
  id: string;
  lastTradeAt: string;
  maxQuantity: bigint;
  /// Signed net quantity for this session: live while OPEN, zero once CLOSE.
  netQuantity: bigint;
  openedAt: string;
  realizedPnl: bigint;
  status: string;
  tradingFees: bigint;
  user: {
    id: string;
  };
  /// Direction of the session, from `sessionIsLong`. `netQuantity` answers this
  /// while the session is open but is zero once it closes, and `maxQuantity`
  /// arrives unsigned, so neither can be read for direction on its own.
  isLong: boolean;
};

export type Trade = {
  aggregatedEntryPriceAfter: bigint;
  blockNumber: number;
  id: string;
  netQuantityAfter: bigint;
  realizedPnl: bigint;
  timestamp: string;
  tradePrice: bigint;
  tradeQuantity: bigint;
  tradingFee: bigint;
  transactionHash: string;
};

export type PositionSessionRow = {
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
  /// One fill, for `sessionIsLong`. The full list is fetched on demand by
  /// `usePerpsSessionTrades` when the trade-details modal opens.
  lastFill: { netQuantityAfter: string; tradeQuantity: string }[];
};

type UserPositionSessionsResponse = {
  sessions: PositionSessionRow[];
};
