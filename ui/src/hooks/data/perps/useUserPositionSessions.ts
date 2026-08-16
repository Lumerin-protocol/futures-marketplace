import { graphqlRequest } from "../graphql";
import { useQuery } from "@tanstack/react-query";
import { UserPositionSessionsQuery } from "./graphql-queries";

export const USER_POSITION_SESSIONS_QK = "UserPositionSessions";

export const useUserPositionSessions = (
  address: `0x${string}` | undefined,
  props?: { refetch?: boolean },
) => {
  const query = useQuery({
    queryKey: [USER_POSITION_SESSIONS_QK, address],
    queryFn: () => fetchUserPositionSessionsAsync(address!),
    enabled: !!address,
    refetchInterval: props?.refetch ? 15_000 : 60_000,
    refetchOnMount: false,
  });

  return query;
};

const fetchUserPositionSessionsAsync = async (
  address: `0x${string}`,
) => {
  const variables = {
    address
  };

  const response = await graphqlRequest<UserPositionSessionsResponse>(
    UserPositionSessionsQuery,
    variables,
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  const data: UserPositionSessions = {
    positionSessions: response.positionSessions.map((session) => ({
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
      trades: session.trades.map((trade) => ({
        aggregatedEntryPriceAfter: BigInt(trade.aggregatedEntryPriceAfter),
        blockNumber: Number(trade.blockNumber),
        id: trade.id,
        netQuantityAfter: BigInt(trade.netQuantityAfter),
        realizedPnl: BigInt(trade.realizedPnl),
        timestamp: trade.timestamp,
        tradePrice: BigInt(trade.tradePrice),
        tradeQuantity: BigInt(trade.tradeQuantity),
        tradingFee: BigInt(trade.tradingFee),
        transactionHash: trade.transactionHash,
      })),
    })),
  };

  return data;
};

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
  trades: Trade[];
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

type UserPositionSessionsResponse = {
  positionSessions: {
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
    trades: {
      aggregatedEntryPriceAfter: string;
      blockNumber: string;
      id: string;
      netQuantityAfter: string;
      realizedPnl: string;
      timestamp: string;
      tradePrice: string;
      tradeQuantity: string;
      tradingFee: string;
      transactionHash: string;
    }[];
  }[];
};
