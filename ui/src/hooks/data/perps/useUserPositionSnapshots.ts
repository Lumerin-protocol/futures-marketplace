import { backgroundRefetchOpts } from "../config";
import { graphqlRequest } from "../graphql";
import { useQuery } from "@tanstack/react-query";
import { UserPositionSnapshotsQuery } from "./graphql-queries";

export const USER_POSITION_SNAPSHOTS_QK = "UserPositionSnapshots";

export const useUserPositionSnapshots = (
  address: `0x${string}` | undefined,
  props?: {
    refetch?: boolean;
  },
) => {
  const query = useQuery({
    queryKey: [USER_POSITION_SNAPSHOTS_QK, address],
    queryFn: () => fetchUserPositionSnapshotsAsync(address!),
    enabled: !!address,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchUserPositionSnapshotsAsync = async (
  address: `0x${string}`,
) => {
  const variables = {
    address,
  };

  const response = await graphqlRequest<UserPositionSnapshotsResponse>(
    UserPositionSnapshotsQuery,
    variables,
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  const data: UserPositionSnapshots = {
    positionSnapshots: response.positionSnapshots.map((snapshot) => ({
      aggregatedEntryPriceAfter: BigInt(snapshot.aggregatedEntryPriceAfter),
      blockNumber: Number(snapshot.blockNumber),
      id: snapshot.id,
      netQuantityAfter: BigInt(snapshot.netQuantityAfter),
      timestamp: snapshot.timestamp,
      tradePrice: BigInt(snapshot.tradePrice),
      tradeQuantity: BigInt(snapshot.tradeQuantity),
      transactionHash: snapshot.transactionHash,
      user: {
        id: snapshot.user.id,
      },
    })),
  };

  return data;
};

export type UserPositionSnapshots = {
  positionSnapshots: PositionSnapshot[];
};

export type PositionSnapshot = {
  aggregatedEntryPriceAfter: bigint;
  blockNumber: number;
  id: string;
  netQuantityAfter: bigint;
  timestamp: string;
  tradePrice: bigint;
  tradeQuantity: bigint;
  transactionHash: string;
  user: {
    id: string;
  };
};

type UserPositionSnapshotsResponse = {
  positionSnapshots: {
    aggregatedEntryPriceAfter: string;
    blockNumber: string;
    id: string;
    netQuantityAfter: string;
    timestamp: string;
    tradePrice: string;
    tradeQuantity: string;
    transactionHash: string;
    user: {
      id: string;
    };
  }[];
};
