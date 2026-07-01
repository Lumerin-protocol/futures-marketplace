import { useQuery } from "@tanstack/react-query";
import { graphqlRequest } from "./graphql";
import { HistoricalOrdersQuery } from "./graphql-queries";

export const HISTORICAL_ORDERS_QK = "HistoricalOrders";

const ORDER_HISTORY_LIMIT = 20;
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

export type HistoricalOrder = {
  id: string;
  timestamp: string;
  deliveryAt: bigint;
  pricePerDay: bigint;
  isBuy: boolean;
  isActive: boolean;
  status: string;
  closedAt: string | null;
  originalQuantity: number;
  filledQuantity: number;
  cancelledQuantity: number;
  /// True if any unit (OrderEntry) of this aggregate order was force-cancelled
  /// by liquidation. The aggregate `status` can't express this (no LIQUIDATED
  /// state), so it's derived from the order's LIQUIDATED entries.
  wasLiquidated: boolean;
  /// Count of liquidated units within this aggregate order.
  liquidatedQuantity: number;
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
    liquidatedEntries: {
      id: string;
      liquidator: string | null;
      liquidationFee: string | null;
    }[];
  }[];
};

// Fetches the most recent N order-history rows in a single request.
// The N-cap is enforced at the GraphQL `first` arg so we never fetch more
// than we need.
const fetchHistoricalOrders = async (
  address: `0x${string}`,
): Promise<{
  data: HistoricalOrder[];
  blockNumber: number;
}> => {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - THIRTY_DAYS_IN_SECONDS;

  const variables = {
    address: address.toLowerCase(),
    thirtyDaysAgo,
    first: ORDER_HISTORY_LIMIT,
    skip: 0,
  };

  const response = await graphqlRequest<HistoricalOrdersResponse>(HistoricalOrdersQuery, variables);

  const orders: HistoricalOrder[] = response.orders.map((order) => ({
    id: order.id,
    timestamp: order.createdAt,
    deliveryAt: BigInt(order.deliveryAt),
    pricePerDay: BigInt(order.price),
    isBuy: order.isBuy,
    // Anything coming back from this query is in a terminal state (FILLED,
    // PARTIALLY_FILLED, or CANCELLED) — never active.
    isActive: false,
    status: order.status,
    closedAt: order.closedAt,
    originalQuantity: order.originalQuantity,
    filledQuantity: order.filledQuantity,
    cancelledQuantity: order.cancelledQuantity,
    wasLiquidated: order.liquidatedEntries.length > 0,
    liquidatedQuantity: order.liquidatedEntries.length,
    participant: {
      address: order.user.id as `0x${string}`,
    },
  }));

  return {
    data: orders,
    blockNumber: response._meta.block.number,
  };
};

export const useHistoricalOrders = (address: `0x${string}` | undefined, enabled: boolean = false) => {
  return useQuery({
    queryKey: [HISTORICAL_ORDERS_QK, address],
    queryFn: () => fetchHistoricalOrders(address!),
    enabled: !!address && enabled,
    staleTime: 60 * 1000, // 1 minute
  });
};
