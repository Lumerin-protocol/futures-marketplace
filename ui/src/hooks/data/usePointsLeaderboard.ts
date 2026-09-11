import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";
import { graphqlRequest } from "./graphql";

// The points data lives in its own subgraph (the points indexer), separate from
// the futures subgraph used by `graphqlRequest`'s default URL.
const POINTS_SUBGRAPH_URL = process.env.REACT_APP_SUBGRAPH_POINTS_URL;

export const POINTS_LEADERBOARD_QK = "PointsLeaderboard";
export const USER_POINTS_QK = "UserPoints";
export const USER_POINTS_MINTS_QK = "UserPointsMints";

// Top traders ordered by their current `total` points, descending.
export const PointsLeaderboardQuery = gql`
  query PointsLeaderboard($first: Int!) {
    userPoints_collection(first: $first, orderBy: total, orderDirection: desc) {
      address
      govReceived
      firstSeenAt
      id
      lastActivityAt
      mintCount
      redeemedPoints
      total
      totalEarned
    }
  }
`;

// A single participant's points entry. The entity `id` is the lowercased
// wallet address.
export const UserPointsQuery = gql`
  query UserPoints($id: ID!) {
    userPoints(id: $id) {
      address
      govReceived
      firstSeenAt
      id
      lastActivityAt
      mintCount
      redeemedPoints
      total
      totalEarned
    }
  }
`;

// Per-user points mint logs (one row per on-chain mint event), newest first.
export const UserPointsMintsQuery = gql`
  query UserPointsMints($user: String!, $first: Int!) {
    pointsMints(
      where: { user: $user }
      first: $first
      orderBy: timestamp
      orderDirection: desc
    ) {
      amount
      blockNumber
      id
      timestamp
      transactionHash
    }
  }
`;

export type PointsUser = {
  id: string;
  address: string;
  total: bigint;
  totalEarned: bigint;
  redeemedPoints: bigint;
  govReceived: bigint;
  mintCount: number;
  firstSeenAt: number;
  lastActivityAt: number;
};

export type PointsMint = {
  id: string;
  amount: bigint;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
};

type RawPointsUser = {
  id: string;
  address: string;
  total: string;
  totalEarned: string;
  redeemedPoints: string;
  govReceived: string;
  mintCount: number;
  firstSeenAt: string;
  lastActivityAt: string;
};

type RawPointsMint = {
  id: string;
  amount: string;
  blockNumber: string;
  timestamp: string;
  transactionHash: string;
};

const mapPointsUser = (raw: RawPointsUser): PointsUser => ({
  id: raw.id,
  address: raw.address,
  total: BigInt(raw.total),
  totalEarned: BigInt(raw.totalEarned),
  redeemedPoints: BigInt(raw.redeemedPoints),
  govReceived: BigInt(raw.govReceived),
  mintCount: raw.mintCount,
  firstSeenAt: Number(raw.firstSeenAt),
  lastActivityAt: Number(raw.lastActivityAt),
});

const mapPointsMint = (raw: RawPointsMint): PointsMint => ({
  id: raw.id,
  amount: BigInt(raw.amount),
  blockNumber: Number(raw.blockNumber),
  timestamp: Number(raw.timestamp),
  transactionHash: raw.transactionHash,
});

const fetchLeaderboard = async (first: number): Promise<PointsUser[]> => {
  const response = await graphqlRequest<{ userPoints_collection: RawPointsUser[] }>(
    PointsLeaderboardQuery,
    { first },
    POINTS_SUBGRAPH_URL,
  );
  return response.userPoints_collection.map(mapPointsUser);
};

const fetchUserPoints = async (address: string): Promise<PointsUser | null> => {
  const response = await graphqlRequest<{ userPoints: RawPointsUser | null }>(
    UserPointsQuery,
    { id: address.toLowerCase() },
    POINTS_SUBGRAPH_URL,
  );
  return response.userPoints ? mapPointsUser(response.userPoints) : null;
};

const fetchUserPointsMints = async (
  address: string,
  first: number,
): Promise<PointsMint[]> => {
  const response = await graphqlRequest<{ pointsMints: RawPointsMint[] }>(
    UserPointsMintsQuery,
    { user: address.toLowerCase(), first },
    POINTS_SUBGRAPH_URL,
  );
  return response.pointsMints.map(mapPointsMint);
};

/// Top `first` traders by current points total (descending). Defaults to 20.
export const usePointsLeaderboard = (first = 20) =>
  useQuery({
    queryKey: [POINTS_LEADERBOARD_QK, first],
    queryFn: () => fetchLeaderboard(first),
    staleTime: 60 * 1000,
  });

/// The connected wallet's current points entry, or `null` if it has never
/// earned points.
export const useUserPoints = (address: `0x${string}` | undefined) =>
  useQuery({
    queryKey: [USER_POINTS_QK, address?.toLowerCase()],
    queryFn: () => {
      if (!address) throw new Error("useUserPoints: address is required");
      return fetchUserPoints(address);
    },
    enabled: !!address,
    staleTime: 60 * 1000,
  });

/// The connected wallet's recent points mint logs (newest first). Defaults to 20.
export const useUserPointsMints = (
  address: `0x${string}` | undefined,
  first = 20,
) =>
  useQuery({
    queryKey: [USER_POINTS_MINTS_QK, address?.toLowerCase(), first],
    queryFn: () => {
      if (!address) throw new Error("useUserPointsMints: address is required");
      return fetchUserPointsMints(address, first);
    },
    enabled: !!address,
    staleTime: 60 * 1000,
  });
