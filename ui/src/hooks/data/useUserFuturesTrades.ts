import { backgroundRefetchOpts } from "./config";
import { UserFuturesTradesQuery } from "./graphql-queries";
import { usePaginatedHistory, type PaginatedHistoryResult } from "./usePaginatedHistory";

export const USER_FUTURES_TRADES_QK = "UserFuturesTrades";

export const useUserFuturesTrades = (
  address: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
  },
): PaginatedHistoryResult<UserFuturesTrade> => {
  return usePaginatedHistory<UserFuturesTradesResponse, UserFuturesTrade>({
    queryKey: [USER_FUTURES_TRADES_QK, address],
    query: UserFuturesTradesQuery,
    variables: { address: address?.toLowerCase() },
    selectRows: (response) => response.trades,
    mapRow: (trade) => ({
      user: {
        id: trade.user.id,
      },
      transactionHash: trade.transactionHash,
      blockNumber: Number(trade.blockNumber),
      expirationAt: trade.expirationAt,
      fillCount: trade.fillCount,
      id: trade.id,
      netQuantityAfter: trade.netQuantityAfter,
      realizedPnl: BigInt(trade.realizedPnl),
      timestamp: trade.timestamp,
      tradePrice: BigInt(trade.tradePrice),
      tradeQuantity: trade.tradeQuantity,
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

/// One on-chain Trade row for a user, sourced from the futures subgraph.
/// Mirrors the perps `UserTrade` shape, but `tradeQuantity`/`netQuantityAfter`
/// are `Int` in the futures schema (contract counts, not USDC-scaled big ints),
/// and `aggregatedEntryPriceAfter` is perps-only and therefore absent.
export type UserFuturesTrade = {
  user: {
    id: string;
  };
  transactionHash: string;
  blockNumber: number;
  expirationAt: string;
  fillCount: number;
  id: string;
  netQuantityAfter: number;
  realizedPnl: bigint;
  timestamp: string;
  tradePrice: bigint;
  tradeQuantity: number;
  tradingFee: bigint;
  isLiquidation: boolean;
  liquidator: string | null;
  liquidationFee: bigint | null;
};

type UserFuturesTradesResponse = {
  trades: {
    user: {
      id: string;
    };
    transactionHash: string;
    blockNumber: string;
    expirationAt: string;
    fillCount: number;
    id: string;
    netQuantityAfter: number;
    realizedPnl: string;
    timestamp: string;
    tradePrice: string;
    tradeQuantity: number;
    tradingFee: string;
    isLiquidation: boolean;
    liquidator: string | null;
    liquidationFee: string | null;
  }[];
};
