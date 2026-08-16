import { UserPerpsOrdersExcludeStatusQuery } from "./graphql-queries";
import type { PerpsOrder } from "./useUserPerpsOrders";
import {
  usePaginatedHistory,
  type PaginatedHistoryResult,
} from "../usePaginatedHistory";

export const PERPS_ORDER_HISTORY_QK = "PerpsOrderHistory";

type RawOrder = {
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
};

type Response = {
  orders: RawOrder[];
};

/// Paginated ("Load More") view of a user's terminal Perps orders (Order
/// History). The open Orders tab keeps using `useUserPerpsOrders` with the
/// ACTIVE/PARTIALLY_FILLED status filter, so both resting statuses are excluded
/// here — a partially filled order is still on the book, not history.
export const usePerpsOrderHistory = (
  address: `0x${string}` | undefined,
  enabled: boolean = true,
): PaginatedHistoryResult<PerpsOrder> => {
  return usePaginatedHistory<Response, PerpsOrder>({
    queryKey: [PERPS_ORDER_HISTORY_QK, address],
    query: UserPerpsOrdersExcludeStatusQuery,
    variables: { address, statuses: ["ACTIVE", "PARTIALLY_FILLED"] },
    subgraphUrl: process.env.REACT_APP_SUBGRAPH_PERPS_URL,
    selectRows: (response) => response.orders,
    mapRow: (order) => ({
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
    }),
    getId: (order) => order.id,
    enabled: !!address && enabled,
  });
};
