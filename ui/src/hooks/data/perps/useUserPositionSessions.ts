import { backgroundRefetchOpts } from "../config";
import { graphqlRequest } from "../graphql";
import { useQuery } from "@tanstack/react-query";
import { UserPositionSessionsQuery } from "./graphql-queries";

export const USER_POSITION_SESSIONS_QK = "UserPositionSessions";

export const useUserPositionSessions = (
  address: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
  },
) => {
  const query = useQuery({
    queryKey: [USER_POSITION_SESSIONS_QK, address],
    queryFn: () => fetchUserPositionSessionsAsync(address!),
    enabled: !!address,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
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
      fundingFees: BigInt(session.fundingFees),
      id: session.id,
      lastTradeAt: session.lastTradeAt,
      maxQuantity: BigInt(session.maxQuantity),
      openedAt: session.openedAt,
      realizedPnl: BigInt(session.realizedPnl),
      status: session.status,
      tradingFees: BigInt(session.tradingFees),
      user: {
        id: session.user.id,
        netQuantity: BigInt(session.user.netQuantity),
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
  fundingFees: bigint;
  id: string;
  lastTradeAt: string;
  maxQuantity: bigint;
  openedAt: string;
  realizedPnl: bigint;
  status: string;
  tradingFees: bigint;
  user: {
    id: string;
    netQuantity: bigint;
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
    fundingFees: string;
    id: string;
    lastTradeAt: string;
    maxQuantity: string;
    openedAt: string;
    realizedPnl: string;
    status: string;
    tradingFees: string;
    user: {
      id: string;
      netQuantity: string;
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
