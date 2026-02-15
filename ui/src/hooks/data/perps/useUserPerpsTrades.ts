import { backgroundRefetchOpts } from "../config";
import { graphqlRequest } from "../graphql";
import { useQuery } from "@tanstack/react-query";
import { UserPerpsTradesQuery } from "./graphql-queries";

export const USER_PERPS_TRADES_QK = "UserPerpsTrades";

export const useUserPerpsTrades = (
  address: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
  },
) => {
  const query = useQuery({
    queryKey: [USER_PERPS_TRADES_QK, address],
    queryFn: () => fetchUserPerpsTradesAsync(address!),
    enabled: !!address,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchUserPerpsTradesAsync = async (
  address: `0x${string}`,
) => {
  const variables = {
    address,
  };

  const response = await graphqlRequest<UserPerpsTradesResponse>(
    UserPerpsTradesQuery,
    variables,
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  const data: UserPerpsTrades = {
    trades: response.trades.map((trade) => ({
      blockNumber: Number(trade.blockNumber),
      makerOrderId: trade.makerOrderId,
      id: trade.id,
      price: BigInt(trade.price),
      quantity: BigInt(trade.quantity),
      timestamp: trade.timestamp,
      transactionHash: trade.transactionHash,
      volume: BigInt(trade.volume),
      seller: {
        id: trade.seller.id,
      },
      buyer: {
        id: trade.buyer.id,
      },
    })),
  };

  return data;
};

export type UserPerpsTrades = {
  trades: PerpsTrade[];
};

export type PerpsTrade = {
  blockNumber: number;
  makerOrderId: string;
  id: string;
  price: bigint;
  quantity: bigint;
  timestamp: string;
  transactionHash: string;
  volume: bigint;
  seller: {
    id: string;
  };
  buyer: {
    id: string;
  };
};

type UserPerpsTradesResponse = {
  trades: {
    blockNumber: string;
    makerOrderId: string;
    id: string;
    price: string;
    quantity: string;
    timestamp: string;
    transactionHash: string;
    volume: string;
    seller: {
      id: string;
    };
    buyer: {
      id: string;
    };
  }[];
};
