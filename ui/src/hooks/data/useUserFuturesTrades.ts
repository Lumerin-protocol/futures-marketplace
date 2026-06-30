import { useQuery } from "@tanstack/react-query";
import { backgroundRefetchOpts } from "./config";
import { graphqlRequest } from "./graphql";
import { UserFuturesTradesQuery } from "./graphql-queries";

export const USER_FUTURES_TRADES_QK = "UserFuturesTrades";

export const useUserFuturesTrades = (
  address: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
  },
) => {
  const query = useQuery({
    queryKey: [USER_FUTURES_TRADES_QK, address],
    queryFn: () => fetchUserFuturesTradesAsync(address!),
    enabled: !!address,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchUserFuturesTradesAsync = async (address: `0x${string}`) => {
  const variables = {
    address: address.toLowerCase(),
  };

  const response = await graphqlRequest<UserFuturesTradesResponse>(
    UserFuturesTradesQuery,
    variables,
  );

  const data: UserFuturesTrades = {
    trades: response.trades.map((trade) => ({
      user: {
        id: trade.user.id,
      },
      transactionHash: trade.transactionHash,
      blockNumber: Number(trade.blockNumber),
      deliveryAt: trade.deliveryAt,
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
      liquidationFee:
        trade.liquidationFee != null ? BigInt(trade.liquidationFee) : null,
    })),
  };

  return data;
};

export type UserFuturesTrades = {
  trades: UserFuturesTrade[];
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
  deliveryAt: string;
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
    deliveryAt: string;
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
