import { useQuery } from "@tanstack/react-query";
import { graphqlRequest } from "./graphql";
import { HistoricalPositionsQuery } from "./graphql-queries";
import { toFuturesSessionTrade, type FuturesSessionTrade } from "./usePositionBook";

export const HISTORICAL_POSITIONS_QK = "HistoricalPositions";

const PAGE_SIZE = 100;
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

export type HistoricalPosition = {
  id: string;
  timestamp: string;
  deliveryAt: string;
  sellPricePerDay: bigint;
  buyPricePerDay: bigint;
  buyerPnl: number;
  sellerPnl: number;
  isActive: boolean;
  closedAt: string | null;
  transactionHash: `0x${string}`;
  buyer: {
    address: `0x${string}`;
  };
  seller: {
    address: `0x${string}`;
  };
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

/// Collapse a closed PositionSession into the legacy HistoricalPosition shape.
/// Direction (long/short) is inferred from the signed sum of trade quantities;
/// the user goes on the matching side, the counterparty slot is the zero address
/// (sessions don't expose it). PnL goes on the user's side, 0 on the other.
const sessionToHistoricalPosition = (
  session: HistoricalPositionsResponse["positionSessions"][number],
): HistoricalPosition => {
  const tradeQuantitySum = session.trades.reduce(
    (acc, t) => acc + Number(t.tradeQuantity),
    0,
  );
  const directionFromTrades =
    tradeQuantitySum !== 0
      ? tradeQuantitySum
      : Number(session.trades[0]?.tradeQuantity ?? 0);
  const isLong = directionFromTrades >= 0;

  const entryPrice = BigInt(session.entryPrice);
  const realizedPnl = Number(session.realizedPnl);

  const latestTrade = session.trades.reduce<HistoricalPositionsResponse["positionSessions"][number]["trades"][number] | undefined>(
    (latest, t) => (!latest || Number(t.timestamp) > Number(latest.timestamp) ? t : latest),
    undefined,
  );

  return {
    id: session.id,
    timestamp: session.openedAt,
    deliveryAt: session.deliveryAt,
    sellPricePerDay: isLong ? 0n : entryPrice,
    buyPricePerDay: isLong ? entryPrice : 0n,
    buyerPnl: isLong ? realizedPnl : 0,
    sellerPnl: isLong ? 0 : realizedPnl,
    isActive: false,
    closedAt: session.lastTradeAt,
    transactionHash: (latestTrade?.transactionHash as `0x${string}`) ?? ZERO_HASH,
    buyer: {
      address: isLong ? (session.user.id as `0x${string}`) : ZERO_ADDRESS,
    },
    seller: {
      address: isLong ? ZERO_ADDRESS : (session.user.id as `0x${string}`),
    },
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
