import { snapshotFedQueryOptions } from "../snapshot/config";
import { graphqlRequest } from "../graphql";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readViaSnapshot } from "../snapshot/snapshotFed";
import { UserPerpsOrdersByStatusQuery, UserPerpsOrdersExcludeStatusQuery } from "../queries/perps";

export const USER_PERPS_ORDERS_QK = "UserPerpsOrders";

/// Statuses that count as "open" on the perps book. Exported because the key
/// below embeds them, so `usePerpsSnapshot` must use the identical value to
/// write the entry this hook reads.
export const ACTIVE_PERPS_ORDER_STATUSES = ["ACTIVE", "PARTIALLY_FILLED"];

/// The filter arguments are part of the key, so the snapshot has to rebuild it
/// the same way — including the trailing `undefined`, which React Query hashes
/// as a distinct value rather than dropping.
export const userPerpsOrdersKey = (
  address: `0x${string}` | undefined,
  statuses?: string[],
  excludeStatuses?: string[],
) => [USER_PERPS_ORDERS_QK, address, statuses, excludeStatuses];

/// Kept fresh by `usePerpsSnapshot` for the active-statuses filter. Other
/// filters fall back to fetching for themselves.
export const useUserPerpsOrders = (
  address: `0x${string}` | undefined,
  props?: {
    statuses?: string[];
    excludeStatuses?: string[];
  },
) => {
  const { statuses, excludeStatuses } = props ?? {};
  const qc = useQueryClient();

  // Only the active-statuses filter is one the snapshot writes; any other filter
  // has to fetch for itself rather than wait on a snapshot that will never
  // populate its entry.
  const isSnapshotFed =
    !excludeStatuses?.length &&
    statuses?.length === ACTIVE_PERPS_ORDER_STATUSES.length &&
    ACTIVE_PERPS_ORDER_STATUSES.every((status) => statuses.includes(status));

  const query = useQuery({
    queryKey: userPerpsOrdersKey(address, statuses, excludeStatuses),
    queryFn: () => {
      if (!address) throw new Error("useUserPerpsOrders: address is required");
      const fetchOwn = () => fetchUserPerpsOrdersAsync(address, { statuses, excludeStatuses });
      if (!isSnapshotFed) return fetchOwn();
      return readViaSnapshot(
        qc,
        "perpetual",
        userPerpsOrdersKey(address, statuses, excludeStatuses),
        fetchOwn,
      );
    },
    enabled: !!address,
    ...snapshotFedQueryOptions,
  });

  return query;
};

const fetchUserPerpsOrdersAsync = async (
  address: `0x${string}`,
  filter?: { statuses?: string[]; excludeStatuses?: string[] },
) => {
  // There is no unfiltered form. `status_in: []` matches nothing rather than
  // everything, so a caller with no filter would silently get an empty book.
  const excluding = !filter?.statuses?.length && !!filter?.excludeStatuses?.length;
  const query = excluding ? UserPerpsOrdersExcludeStatusQuery : UserPerpsOrdersByStatusQuery;

  const statuses = excluding ? filter?.excludeStatuses : filter?.statuses;
  if (!statuses?.length) {
    throw new Error("useUserPerpsOrders: a status filter is required");
  }

  const response = await graphqlRequest<UserPerpsOrdersResponse>(
    query,
    excluding
      ? { address, excludeStatuses: statuses, historyFirst: ORDER_PAGE_SIZE, historySkip: 0 }
      : { address, statuses },
    process.env.REACT_APP_SUBGRAPH_PERPS_URL,
  );

  return {
    data: mapUserPerpsOrders((excluding ? response.historyOrders : response.myOrders) ?? []),
    blockNumber: response._meta.block.number,
    timestamp: Number(response._meta.block.timestamp),
  };
};

/** Matches the page size `usePerpsOrderHistory` asks for. */
const ORDER_PAGE_SIZE = 100;

/// Shared with `PerpsSnapshotQuery`'s `myOrders` alias, which writes this cache
/// entry directly. Both paths must produce identical shapes.
export const mapUserPerpsOrders = (rows: PerpsOrderRow[]): UserPerpsOrders => ({
  orders: rows.map((order) => ({
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
});

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

export type PerpsOrderRow = {
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

type UserPerpsOrdersResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: number;
    };
  };
  /** Present when filtering by status; the `myOrders` slice. */
  myOrders?: PerpsOrderRow[];
  /** Present when excluding statuses; the `historyOrders` slice. */
  historyOrders?: PerpsOrderRow[];
};
