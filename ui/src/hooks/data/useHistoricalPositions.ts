import { useQuery } from "@tanstack/react-query";
import { graphqlRequest } from "./graphql";
import { HistoricalPositionsQuery } from "./graphql-queries";
import { toFuturesSessionTrade, type FuturesSessionTrade } from "./getUserFuturesPositions";

export const HISTORICAL_POSITIONS_QK = "HistoricalPositions";

const PAGE_SIZE = 100;
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

export type HistoricalPosition = {
  id: string;
  timestamp: string;
  deliveryAt: string;
  /// Session entry price (per day). Replaces the legacy buy/sell split — the
  /// session is owned by a single user, so a single price is sufficient and
  /// the side is conveyed via `isLong`.
  pricePerDay: bigint;
  /// Realized PnL for the session as reported by the indexer. Replaces the
  /// legacy `buyerPnl` / `sellerPnl` split.
  pnl: number;
  /// Direction of the closed session, inferred from the signed sum of the
  /// underlying trade quantities.
  isLong: boolean;
  /// Cumulative qty closed during the session's lifetime (mirrors
  /// `PositionSession.closedQuantity` on the indexer).
  closedQuantity: number;
  /// Peak signed net quantity reached during the session's lifetime
  /// (mirrors `PositionSession.maxQuantity` on the indexer). Positive for
  /// long sessions, negative for short sessions. Use `Math.abs` for display.
  maxQuantity: number;
  isActive: boolean;
  closedAt: string | null;
  /// Pinned cash-settlement price for this expiration (token decimals), or null.
  settlementPrice: bigint | null;
  /// Block timestamp at which the settlement price was pinned, or null.
  settledAt: string | null;
  transactionHash: `0x${string}`;
  // Underlying on-chain Trade rows from the source PositionSession.
  trades: FuturesSessionTrade[];
};

type HistoricalPositionsResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  positionSessions: {
    id: string;
    status: string;
    deliveryAt: string;
    entryPrice: string;
    closePrice: string;
    closedQuantity: number;
    maxQuantity: number;
    openedAt: string;
    lastTradeAt: string;
    realizedPnl: string;
    tradingFees: string;
    expiration: {
      settlementPrice: string | null;
      settledAt: string | null;
    } | null;
    user: {
      id: string;
    };
    trades: {
      id: string;
      blockNumber: string;
      deliveryAt: string;
      fillCount: number;
      netQuantityAfter: number;
      realizedPnl: string;
      timestamp: string;
      tradePrice: string;
      tradeQuantity: number;
      tradingFee: string;
      transactionHash: `0x${string}`;
    }[];
  }[];
};

/// Collapse a closed PositionSession into the HistoricalPosition shape.
/// Direction (long/short) is taken from the sign of the session's first
/// trade — the fill that opened the position. Subsequent fills (partial or
/// full closes) flip sign, so summing them would misrepresent the side a
/// user actually entered. Price comes from the session's `entryPrice` and
/// PnL from `realizedPnl` — the row no longer encodes a buyer/seller split
/// since a session belongs to a single user.
const sessionToHistoricalPosition = (
  session: HistoricalPositionsResponse["positionSessions"][number],
): HistoricalPosition => {
  type SessionTrade = HistoricalPositionsResponse["positionSessions"][number]["trades"][number];

  // Earliest trade by (timestamp, blockNumber, fillCount). Subgraph ordering
  // for nested arrays isn't guaranteed, so sort defensively.
  const firstTrade = session.trades.reduce<SessionTrade | undefined>((earliest, t) => {
    if (!earliest) return t;
    const earliestKey = [
      Number(earliest.timestamp),
      Number(earliest.blockNumber),
      earliest.fillCount,
    ];
    const candidateKey = [Number(t.timestamp), Number(t.blockNumber), t.fillCount];
    for (let i = 0; i < earliestKey.length; i++) {
      if (candidateKey[i] < earliestKey[i]) return t;
      if (candidateKey[i] > earliestKey[i]) return earliest;
    }
    return earliest;
  }, undefined);

  const isLong = Number(firstTrade?.tradeQuantity ?? 0) >= 0;

  const latestTrade = session.trades.reduce<SessionTrade | undefined>(
    (latest, t) => (!latest || Number(t.timestamp) > Number(latest.timestamp) ? t : latest),
    undefined,
  );

  return {
    id: session.id,
    timestamp: session.openedAt,
    deliveryAt: session.deliveryAt,
    pricePerDay: BigInt(session.entryPrice),
    pnl: Number(session.realizedPnl),
    isLong,
    closedQuantity: session.closedQuantity,
    maxQuantity: session.maxQuantity,
    isActive: false,
    closedAt: session.lastTradeAt,
    settlementPrice:
      session.expiration && session.expiration.settlementPrice != null
        ? BigInt(session.expiration.settlementPrice)
        : null,
    settledAt: session.expiration?.settledAt ?? null,
    transactionHash: (latestTrade?.transactionHash as `0x${string}`) ?? ZERO_HASH,
    trades: session.trades.map(toFuturesSessionTrade),
  };
};

const fetchAllHistoricalPositions = async (
  address: `0x${string}`,
): Promise<{
  data: HistoricalPosition[];
  blockNumber: number;
}> => {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - THIRTY_DAYS_IN_SECONDS;

  let allPositions: HistoricalPosition[] = [];
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

    const response = await graphqlRequest<HistoricalPositionsResponse>(
      HistoricalPositionsQuery,
      variables,
    );

    blockNumber = response._meta.block.number;

    allPositions = allPositions.concat(
      response.positionSessions.map(sessionToHistoricalPosition),
    );

    if (response.positionSessions.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  return {
    data: allPositions,
    blockNumber,
  };
};

export const useHistoricalPositions = (address: `0x${string}` | undefined, enabled: boolean = false) => {
  return useQuery({
    queryKey: [HISTORICAL_POSITIONS_QK, address],
    queryFn: () => fetchAllHistoricalPositions(address!),
    enabled: !!address && enabled,
    staleTime: 60 * 1000, // 1 minute
  });
};
