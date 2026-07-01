import { HistoricalOrdersQuery } from "./graphql-queries";
import { usePaginatedHistory, type PaginatedHistoryResult } from "./usePaginatedHistory";

export const HISTORICAL_ORDERS_QK = "HistoricalOrders";

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

type RawOrder = {
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
};

type HistoricalOrdersResponse = {
  orders: RawOrder[];
};

const mapOrder = (order: RawOrder): HistoricalOrder => ({
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
});

export const useHistoricalOrders = (
  address: `0x${string}` | undefined,
  enabled: boolean = false,
): PaginatedHistoryResult<HistoricalOrder> => {
  return usePaginatedHistory<HistoricalOrdersResponse, HistoricalOrder>({
    queryKey: [HISTORICAL_ORDERS_QK, address],
    query: HistoricalOrdersQuery,
    variables: { address: address?.toLowerCase() },
    selectRows: (response) => response.orders,
    mapRow: mapOrder,
    getId: (order) => order.id,
    enabled: !!address && enabled,
  });
};
