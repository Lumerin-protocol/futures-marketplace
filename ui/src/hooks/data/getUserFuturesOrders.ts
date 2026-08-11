import { backgroundRefetchOpts } from "./config";
import { graphqlRequest } from "./graphql";
import { useQuery } from "@tanstack/react-query";
import { UserFuturesOrdersByStatusQuery } from "./graphql-queries";

export const PARTICIPANT_QK = "Participant";

/// Statuses that count as "open" on the order book — i.e. orders the UI shows
/// in the active list and uses for conflict detection in PlaceOrder/ModifyOrder.
const ACTIVE_STATUSES = ["ACTIVE", "PARTIAL"] as const;

export const getUserFuturesOrders = (
  participantAddress: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
    orderOffset?: number;
    orderLimit?: number;
  },
) => {
  const query = useQuery({
    queryKey: [PARTICIPANT_QK],
    queryFn: () => {
      if (!participantAddress) throw new Error("getUserFuturesOrders: participantAddress is required");
      return fetchParticipantAsync(participantAddress, props);
    },
    enabled: !!participantAddress,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchParticipantAsync = async (
  participantAddress: `0x${string}`,
  props?: {
    orderOffset?: number;
    orderLimit?: number;
  },
) => {
  const now = Math.floor(Date.now() / 1000);
  const variables = {
    address: participantAddress.toLowerCase(),
    statuses: [...ACTIVE_STATUSES],
    now,
    first: props?.orderLimit ?? 100,
    skip: props?.orderOffset ?? 0,
  };

  const response = await graphqlRequest<UserFuturesOrdersResponse>(
    UserFuturesOrdersByStatusQuery,
    variables,
  );

  const orders: ParticipantOrder[] = response.orders.map((order) => ({
    id: order.id,
    // Cancel/modify must use OrderEntry.id (on-chain bytes32), never Order.id
    // (composite indexer key: txHash++user++price++expiration++side).
    entryIds: order.entries.map((entry) => entry.id),
    isBuy: order.isBuy,
    isActive: isActiveStatus(order.status),
    pricePerDay: BigInt(order.price),
    expirationAt: BigInt(order.expirationAt),
    timestamp: order.createdAt,
    closedAt: order.closedAt,
    // 3.0: one createOrder → one OrderEntry with abs qty; aggregates may still
    // collapse same-tx same-price placements. `quantity` is remaining contracts.
    quantity: order.quantity,
    originalQuantity: order.originalQuantity,
    filledQuantity: order.filledQuantity,
    cancelledQuantity: order.cancelledQuantity,
    closedBy: null,
    participant: {
      address: (order.user.id as `0x${string}`) ?? participantAddress,
    },
  }));

  const data: Participant = {
    address: participantAddress,
    orderCount: orders.length,
    totalVolume: 0n,
    orders,
  };

  return {
    data,
    blockNumber: response._meta.block.number,
  };
};

const isActiveStatus = (status: string): boolean =>
  status === "ACTIVE" || status === "PARTIAL";

export const waitForBlockNumber = async (blockNumber: bigint, participantAddress: `0x${string}`) => {
  const delay = 1000;
  const maxAttempts = 30; // 30 attempts with 1s delay = max 30 seconds wait

  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const data = await fetchParticipantAsync(participantAddress);
    const currentBlock = data?.blockNumber;

    if (currentBlock !== undefined && currentBlock >= Number(blockNumber)) {
      return;
    }
    attempts++;
  }

  throw new Error(`Timeout waiting for block number ${blockNumber}`);
};

export type Participant = {
  address: `0x${string}`;
  orderCount: number;
  totalVolume: bigint;
  orders: ParticipantOrder[];
};

export type ParticipantOrder = {
  closedAt: string | null;
  closedBy: string | null;
  expirationAt: bigint;
  /** Indexer Order aggregate id (not a valid on-chain bytes32). */
  id: string;
  /** On-chain order ids (`OrderEntry.id`) still ACTIVE under this aggregate. */
  entryIds: string[];
  isActive: boolean;
  isBuy: boolean;
  participant: {
    address: `0x${string}`;
  };
  pricePerDay: bigint;
  /// Currently-open units = originalQuantity − filledQuantity − cancelledQuantity.
  quantity: number;
  /// Initial units across all entries when the Order was first emitted.
  originalQuantity: number;
  /// Number of underlying entries that have matched (i.e. became Fills).
  filledQuantity: number;
  /// Number of underlying entries that closed without matching.
  cancelledQuantity: number;
  timestamp: string;
};

type UserFuturesOrdersResponse = {
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
    expirationAt: string;
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
    entries: {
      id: string;
      remainingQuantity: number;
      status: string;
    }[];
  }[];
};
