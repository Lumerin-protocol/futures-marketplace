import { backgroundRefetchOpts } from "./config";
import { graphqlRequest } from "./graphql";
import { QueryClient, useQuery } from "@tanstack/react-query";
import type { GetResponse } from "../../gateway/interfaces";
import { PositionsBookQuery } from "./graphql-queries";

export const POSITION_BOOK_QK = "PositionBook";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

export const usePositionBook = (address: `0x${string}` | undefined, props?: { refetch?: boolean }) => {
  const query = useQuery({
    queryKey: [POSITION_BOOK_QK],
    queryFn: () => fetchPositionBookAsync(address!),
    enabled: !!address,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchPositionBookAsync = async (address: `0x${string}`) => {
  const variables = { address: address.toLowerCase() };

  const response = await graphqlRequest<PositionsBookResponse>(PositionsBookQuery, variables);

  const data: PositionBook = {
    positions: response.positionSessions.map(sessionToPosition),
  };

  return {
    data,
    blockNumber: response._meta.block.number,
  };
};

/// Collapse one PositionSession into the legacy PositionBookPosition shape so that
/// existing consumers (PositionsListWidget, Futures.tsx, FuturesTradesModal, …) can
/// keep treating each row as a buyer/seller pair. Direction is inferred from the
/// signed sum of trade quantities; the user goes on the matching side and the
/// counterparty slot is filled with the zero address (sessions don't expose it).
/// The session's underlying Trade entities are attached as-is so the trades modal
/// can render real fill rows instead of synthesising them per position.
const sessionToPosition = (
  session: PositionsBookResponse["positionSessions"][number],
): PositionBookPosition => {
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

  // Latest trade by timestamp drives the row-level transactionHash so consumers
  // that key by tx (e.g. FuturesTradesModal grouping) stay deterministic.
  const latestTrade = session.trades.reduce<PositionsBookResponse["positionSessions"][number]["trades"][number] | undefined>(
    (latest, t) => (!latest || Number(t.timestamp) > Number(latest.timestamp) ? t : latest),
    undefined,
  );

  const isActive = session.status === "OPEN";

  return {
    id: session.id,
    timestamp: session.openedAt,
    deliveryAt: session.deliveryAt,
    sellPricePerDay: isLong ? 0n : entryPrice,
    buyPricePerDay: isLong ? entryPrice : 0n,
    isActive,
    closedAt: isActive ? null : session.lastTradeAt,
    closedBy: null,
    destURL: "",
    isPaid: false,
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

/// One Trade row from a PositionSession.trades — the actual on-chain fill events.
/// Surfaced through PositionBookPosition.trades and HistoricalPosition.trades so
/// the FuturesTradesModal can render real per-fill rows.
export type FuturesSessionTrade = {
  id: string;
  blockNumber: number;
  fillCount: number;
  netQuantityAfter: number;
  realizedPnl: bigint;
  timestamp: string;
  tradePrice: bigint;
  tradeQuantity: number;
  tradingFee: bigint;
  transactionHash: `0x${string}`;
};

export const toFuturesSessionTrade = (
  trade: PositionsBookResponse["positionSessions"][number]["trades"][number],
): FuturesSessionTrade => ({
  id: trade.id,
  blockNumber: Number(trade.blockNumber),
  fillCount: trade.fillCount,
  netQuantityAfter: trade.netQuantityAfter,
  realizedPnl: BigInt(trade.realizedPnl),
  timestamp: trade.timestamp,
  tradePrice: BigInt(trade.tradePrice),
  tradeQuantity: trade.tradeQuantity,
  tradingFee: BigInt(trade.tradingFee),
  transactionHash: trade.transactionHash,
});

export const waitForBlockNumberPositionBook = async (blockNumber: bigint, qc: QueryClient) => {
  const delay = 1000;
  const maxAttempts = 30; // 30 attempts with 1s delay = max 30 seconds wait

  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    // Force a fresh fetch of the data
    await qc.refetchQueries({ queryKey: [POSITION_BOOK_QK] });

    const data = qc.getQueryData<GetResponse<PositionBook>>([POSITION_BOOK_QK]);
    const currentBlock = data?.blockNumber;

    if (currentBlock !== undefined && currentBlock >= Number(blockNumber)) {
      return;
    }
    attempts++;
  }

  throw new Error(`Timeout waiting for block number ${blockNumber}`);
};

export type PositionBook = {
  positions: PositionBookPosition[];
};

export type PositionBookPosition = {
  transactionHash: `0x${string}`;
  timestamp: string;
  deliveryAt: string;
  sellPricePerDay: bigint;
  buyPricePerDay: bigint;
  isActive: boolean;
  id: string;
  closedBy: string | null;
  destURL: string;
  closedAt: string | null;
  isPaid: boolean;
  buyer: {
    address: `0x${string}`;
  };
  seller: {
    address: `0x${string}`;
  };
  // Underlying on-chain Trade rows from the source PositionSession.
  // Used by FuturesTradesModal to render real per-fill rows.
  trades: FuturesSessionTrade[];
};

type PositionsBookResponse = {
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
