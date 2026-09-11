import { backgroundRefetchOpts } from "../config";
import { UserTradesQuery } from "./graphql-queries";
import {
  usePaginatedHistory,
  type PaginatedHistoryResult,
} from "../usePaginatedHistory";

export const USER_TRADES_QK = "UserTrades";

export const useUserTrades = (
  address: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
  },
): PaginatedHistoryResult<UserTrade> => {
  return usePaginatedHistory<UserTradesResponse, UserTrade>({
    queryKey: [USER_TRADES_QK, address],
    query: UserTradesQuery,
    variables: { address },
    subgraphUrl: process.env.REACT_APP_SUBGRAPH_PERPS_URL,
    selectRows: (response) => response.trades,
    mapRow: (trade) => ({
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
      isLiquidation: trade.isLiquidation,
      liquidator: trade.liquidator,
      liquidationFee: trade.liquidationFee != null ? BigInt(trade.liquidationFee) : null,
    }),
    getId: (trade) => trade.id,
    enabled: !!address,
    refetchInterval: props?.refetch ? backgroundRefetchOpts.refetchInterval : undefined,
  });
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
  isLiquidation: boolean;
  liquidator: string | null;
  liquidationFee: bigint | null;
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
    isLiquidation: boolean;
    liquidator: string | null;
    liquidationFee: string | null;
  }[];
};
