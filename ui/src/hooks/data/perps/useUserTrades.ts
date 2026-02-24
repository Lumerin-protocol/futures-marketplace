import { backgroundRefetchOpts } from "../config";
import { graphqlRequest } from "../graphql";
import { useQuery } from "@tanstack/react-query";
import { UserTradesQuery } from "./graphql-queries";

export const USER_TRADES_QK = "UserTrades";

export const useUserTrades = (
  address: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
  },
) => {
  const query = useQuery({
    queryKey: [USER_TRADES_QK, address],
    queryFn: () => fetchUserTradesAsync(address!),
    enabled: !!address,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchUserTradesAsync = async (
  address: `0x${string}`,
) => {
  const variables = {
    address
  };

  const response = await graphqlRequest<UserTradesResponse>(
    UserTradesQuery,
    variables,
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  const data: UserTrades = {
    trades: response.trades.map((trade) => ({
      user: {
        id: trade.user.id,
      },
      transactionHash: trade.transactionHash,
      aggregatedEntryPriceAfter: BigInt(trade.aggregatedEntryPriceAfter),
      blockNumber: Number(trade.blockNumber),
      id: trade.id,
      netQuantityAfter: BigInt(trade.netQuantityAfter),
      realizedPnl: BigInt(trade.realizedPnl),
      timestamp: trade.timestamp,
      tradePrice: BigInt(trade.tradePrice),
      tradeQuantity: BigInt(trade.tradeQuantity),
      tradingFee: BigInt(trade.tradingFee),
    })),
  };

  return data;
};

export type UserTrades = {
  trades: UserTrade[];
};

export type UserTrade = {
  user: {
    id: string;
  };
  transactionHash: string;
  aggregatedEntryPriceAfter: bigint;
  blockNumber: number;
  id: string;
  netQuantityAfter: bigint;
  realizedPnl: bigint;
  timestamp: string;
  tradePrice: bigint;
  tradeQuantity: bigint;
  tradingFee: bigint;
};

type UserTradesResponse = {
  trades: {
    user: {
      id: string;
    };
    transactionHash: string;
    aggregatedEntryPriceAfter: string;
    blockNumber: string;
    id: string;
    netQuantityAfter: string;
    realizedPnl: string;
    timestamp: string;
    tradePrice: string;
    tradeQuantity: string;
    tradingFee: string;
  }[];
};
