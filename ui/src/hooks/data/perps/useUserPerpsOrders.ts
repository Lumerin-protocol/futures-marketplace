import { backgroundRefetchOpts } from "../config";
import { graphqlRequest } from "../graphql";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { UserPerpsOrdersQuery } from "./graphql-queries";

export const USER_PERPS_ORDERS_QK = "UserPerpsOrders";

export const useUserPerpsOrders = (
  address: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
  },
) => {
  const query = useQuery({
    queryKey: [USER_PERPS_ORDERS_QK, address],
    queryFn: () => fetchUserPerpsOrdersAsync(address!),
    enabled: !!address,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchUserPerpsOrdersAsync = async (
  address: `0x${string}`,
) => {
  const variables = {
    address,
  };

  const response = await graphqlRequest<UserPerpsOrdersResponse>(
    UserPerpsOrdersQuery,
    variables,
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  const data: UserPerpsOrders = {
    orders: response.orders.map((order) => ({
      blockNumber: Number(order.blockNumber),
      closedAt: order.closedAt,
      createdAt: order.createdAt,
      filledQuantity: BigInt(order.filledQuantity),
      id: order.id,
      originalQuantity: BigInt(order.originalQuantity),
      isBuy: order.isBuy,
      price: BigInt(order.price),
      quantity: BigInt(order.quantity),
      status: order.status,
      transactionHash: order.transactionHash,
      updatedAt: order.updatedAt,
      user: {
        id: order.user.id,
      },
    })),
  };

  return {
    data,
    blockNumber: response._meta.block.number,
    timestamp: Number(response._meta.block.timestamp),
  };
};

export const waitForBlockNumber = async (
  blockNumber: bigint,
  address: `0x${string}`
) => {
  const delay = 1000;
  const maxAttempts = 30; // 30 attempts with 1s delay = max 30 seconds wait

  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const data = await fetchUserPerpsOrdersAsync(address);
    const currentBlock = data?.blockNumber;

    if (currentBlock !== undefined && currentBlock >= Number(blockNumber)) {
      return;
    }
    attempts++;
  }

  throw new Error(`Timeout waiting for block number ${blockNumber}`);
};

export type UserPerpsOrders = {
  orders: PerpsOrder[];
};

export type PerpsOrder = {
  blockNumber: number;
  closedAt: string | null;
  createdAt: string;
  filledQuantity: bigint;
  id: string;
  originalQuantity: bigint;
  isBuy: boolean;
  price: bigint;
  quantity: bigint;
  status: string;
  transactionHash: string;
  updatedAt: string;
  user: {
    id: string;
  };
};

type UserPerpsOrdersResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: number;
    };
  };
  orders: {
    blockNumber: string;
    closedAt: string | null;
    createdAt: string;
    filledQuantity: string;
    id: string;
    originalQuantity: string;
    isBuy: boolean;
    price: string;
    quantity: string;
    status: string;
    transactionHash: string;
    updatedAt: string;
    user: {
      id: string;
    };
  }[];
};
