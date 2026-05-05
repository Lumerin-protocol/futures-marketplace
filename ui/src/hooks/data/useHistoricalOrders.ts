import { useQuery } from "@tanstack/react-query";
import { graphqlRequest } from "./graphql";
import { HistoricalOrdersQuery } from "./graphql-queries";

export const HISTORICAL_ORDERS_QK = "HistoricalOrders";

const PAGE_SIZE = 100;
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

export type HistoricalOrder = {
  id: string;
  timestamp: string;
  deliveryAt: bigint;
  pricePerDay: bigint;
  isBuy: boolean;
  isActive: boolean;
  closedAt: string | null;
  originalQuantity: number;
  filledQuantity: number;
  cancelledQuantity: number;
  participant: {
    address: `0x${string}`;
  };
};

type HistoricalOrdersResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  orders: {
    user: {
      id: string;
    };
    blockNumber: string;
    cancelledQuantity: number;
    closedAt: string | null;
    deliveryAt: string;
    createdAt: string;
    filledQuantity: number;
    id: string;
    isBuy: boolean;
    originalQuantity: number;
    quantity: number;
    price: string;
    status: string;
    transactionHash: `0x${string}`;
    updatedAt: string;
  }[];
};

const fetchAllHistoricalOrders = async (
  address: `0x${string}`,
): Promise<{
  data: HistoricalOrder[];
  blockNumber: number;
}> => {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - THIRTY_DAYS_IN_SECONDS;

  let allOrders: HistoricalOrder[] = [];
  let skip = 0;
  let hasMore = true;
  let blockNumber = 0;

  while (hasMore) {
    const variables = {
      address: address.toLowerCase(),
      thirtyDaysAgo,
      first: PAGE_SIZE,
      skip,
    };

    const response = await graphqlRequest<HistoricalOrdersResponse>(HistoricalOrdersQuery, variables);

    blockNumber = response._meta.block.number;

    const orders: HistoricalOrder[] = response.orders.map((order) => ({
      id: order.id,
      timestamp: order.createdAt,
      deliveryAt: BigInt(order.deliveryAt),
      pricePerDay: BigInt(order.price),
      isBuy: order.isBuy,
      // Anything coming back from this query is FILLED or CANCELLED — never active.
      isActive: false,
      closedAt: order.closedAt,
      originalQuantity: order.originalQuantity,
      filledQuantity: order.filledQuantity,
      cancelledQuantity: order.cancelledQuantity,
      participant: {
        address: order.user.id as `0x${string}`,
      },
    }));

    allOrders = allOrders.concat(orders);

    if (response.orders.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  return {
    data: allOrders,
    blockNumber,
  };
};

export const useHistoricalOrders = (address: `0x${string}` | undefined, enabled: boolean = false) => {
  return useQuery({
    queryKey: [HISTORICAL_ORDERS_QK, address],
    queryFn: () => fetchAllHistoricalOrders(address!),
    enabled: !!address && enabled,
    staleTime: 60 * 1000, // 1 minute
  });
};
