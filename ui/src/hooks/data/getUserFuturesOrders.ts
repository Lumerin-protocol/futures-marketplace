import { backgroundRefetchOpts } from "./config";
import { graphqlRequest } from "./graphql";
import { useQuery } from "@tanstack/react-query";
import { UserFuturesOrdersByStatusQuery } from "./graphql-queries";

export const PARTICIPANT_QK = "Participant";

/// Statuses that count as "open" on the order book — i.e. orders the UI shows
/// in the active list and uses for conflict detection in PlaceOrder/ModifyOrder.
const ACTIVE_STATUSES = ["ACTIVE", "PARTIALLY_FILLED"] as const;

export const getUserFuturesOrders = (
  participantAddress: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
    orderOffset?: number;
    orderLimit?: number;
  },
) => {
  const query = useQuery({
    // The address belongs in the key: without it every account shares one cache
    // entry, so switching wallets serves the previous account's order ids to
    // Close/Modify and the contract rejects them as not the sender's.
    queryKey: [PARTICIPANT_QK, participantAddress],
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
    isBuy: order.isBuy,
    isActive: isActiveStatus(order.status),
    pricePerDay: BigInt(order.price),
    expirationAt: BigInt(order.expirationAt),
    timestamp: order.createdAt,
    closedAt: order.closedAt,
    // GraphQL BigInt scalars arrive as strings. Coerce here so grouping
    // (`0 + qty`) cannot concatenate into "01", and Modify Order gets a number.
    quantity: Number(order.quantity),
    originalQuantity: Number(order.originalQuantity),
    filledQuantity: Number(order.filledQuantity),
    cancelledQuantity: Number(order.cancelledQuantity),
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
  status === "ACTIVE" || status === "PARTIALLY_FILLED";

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
  /** On-chain bytes32 orderId — what cancelOrder / updateOrders take. */
  id: string;
  isActive: boolean;
  isBuy: boolean;
  participant: {
    address: `0x${string}`;
  };
  pricePerDay: bigint;
  /// Contracts still resting = originalQuantity − filledQuantity − cancelledQuantity.
  quantity: number;
  /// Contracts requested by the OrderCreated event that opened this order.
  originalQuantity: number;
  /// Contracts that became fills.
  filledQuantity: number;
  /// Contracts that left the book without matching.
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
    cancelledQuantity: string;
    closedAt: string | null;
    expirationAt: string;
    createdAt: string;
    filledQuantity: string;
    id: string;
    isBuy: boolean;
    originalQuantity: string;
    quantity: string;
    price: string;
    status: string;
    transactionHash: `0x${string}`;
    updatedAt: string;
  }[];
};
