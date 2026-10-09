import { snapshotFedQueryOptions } from "./snapshot/config";
import { graphqlRequest } from "./graphql";
import { sessionIsLong } from "../../lib/positionDirection";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PositionsBookQuery } from "./queries/futures";
import { readViaSnapshot } from "./snapshot/snapshotFed";

export const POSITION_BOOK_QK = "PositionBook";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

/// Kept fresh by `useFuturesSnapshot`, which writes this cache entry directly.
export const getUserFuturesPositions = (address: `0x${string}` | undefined) => {
  const qc = useQueryClient();
  const query = useQuery({
    // Keyed by address so switching wallets cannot serve the previous
    // account's positions out of the cache.
    queryKey: [POSITION_BOOK_QK, address],
    queryFn: () => {
      if (!address) throw new Error("getUserFuturesPositions: address is required");
      return readViaSnapshot(qc, "futures", [POSITION_BOOK_QK, address], () =>
        fetchPositionBookAsync(address),
      );
    },
    enabled: !!address,
    ...snapshotFedQueryOptions,
  });

  return query;
};

const fetchPositionBookAsync = async (address: `0x${string}`) => {
  const variables = { address: address.toLowerCase() };

  const response = await graphqlRequest<PositionsBookResponse>(PositionsBookQuery, variables);

  return {
    data: mapPositionBook(response.positions),
    blockNumber: response._meta.block.number,
  };
};

/// Fed by the `positions` slice, whether it arrived batched into a venue tick
/// or through the standalone document built from that same slice.
export const mapPositionBook = (
  sessions: PositionsBookResponse["positions"],
): PositionBook => ({
  positions: sessions.map(sessionToPosition),
});

/// Collapse one PositionSession into the legacy PositionBookPosition shape so that
/// existing consumers (PositionsListWidget, Futures.tsx, FuturesTradesModal, …) can
/// keep treating each row as a buyer/seller pair. The user goes on the side matching
/// the direction and the counterparty slot is filled with the zero address (sessions
/// don't expose it).
///
/// Direction comes from `sessionIsLong`. This book only queries open sessions
/// (`netQuantity_not: 0`), so it always resolves off the net quantity, but it
/// goes through the shared rule so that the four session mappers cannot disagree.
const sessionToPosition = (
  session: PositionsBookResponse["positions"][number],
): PositionBookPosition => {
  const isLong = sessionIsLong(session.netQuantity, session.lastFill[0]);

  const entryPrice = BigInt(session.entryPrice);

  const isActive = session.status === "OPEN";

  const settlementPrice =
    session.expiration && session.expiration.settlementPrice != null
      ? BigInt(session.expiration.settlementPrice)
      : null;
  const settledAt = session.expiration?.settledAt ?? null;

  return {
    id: session.id,
    timestamp: session.openedAt,
    expirationAt: session.expirationAt,
    sellPricePerDay: isLong ? 0n : entryPrice,
    buyPricePerDay: isLong ? entryPrice : 0n,
    netQuantity: session.netQuantity,
    liquidatedQuantity: session.liquidatedQuantity,
    isActive,
    settlementPrice,
    settledAt,
    closedAt: isActive ? null : session.lastTradeAt,
    closedBy: null,
    buyer: {
      address: isLong ? (session.user.id as `0x${string}`) : ZERO_ADDRESS,
    },
    seller: {
      address: isLong ? ZERO_ADDRESS : (session.user.id as `0x${string}`),
    },
  };
};

/// One on-chain fill. Reaches the UI only through `useSessionTrades`, which the
/// trades modal calls when it opens; no session query carries fills any more.
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

export type RawSessionTrade = {
  id: string;
  blockNumber: string;
  expirationAt: string;
  fillCount: number;
  netQuantityAfter: number;
  realizedPnl: string;
  timestamp: string;
  tradePrice: string;
  tradeQuantity: number;
  tradingFee: string;
  transactionHash: `0x${string}`;
};

export const toFuturesSessionTrade = (trade: RawSessionTrade): FuturesSessionTrade => ({
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

export type PositionBook = {
  positions: PositionBookPosition[];
};

export type PositionBookPosition = {
  timestamp: string;
  expirationAt: string;
  sellPricePerDay: bigint;
  buyPricePerDay: bigint;
  /// Signed running net qty for the (user, expirationAt) pair the source
  /// PositionSession belongs to. Mirrors `UserDeliverySessionPointer.netQuantity`
  /// while the session is OPEN; 0 once the session is CLOSE.
  netQuantity: number;
  /// Cumulative qty force-closed via liquidation on the source PositionSession
  /// (mirrors `PositionSession.liquidatedQuantity`). 0 if never liquidated.
  liquidatedQuantity: number;
  isActive: boolean;
  /// Pinned cash-settlement price for this position's expiration (token decimals),
  /// or null until `SettlementPriceRecorded` has fired for the expirationAt.
  settlementPrice: bigint | null;
  /// Block timestamp at which the settlement price was pinned, or null.
  settledAt: string | null;
  id: string;
  closedBy: string | null;
  closedAt: string | null;
  buyer: {
    address: `0x${string}`;
  };
  seller: {
    address: `0x${string}`;
  };
};

export type PositionSessionRow = {
  id: string;
  status: string;
  expirationAt: string;
  entryPrice: string;
  closePrice: string;
  closedQuantity: number;
  liquidatedQuantity: number;
  maxQuantity: number;
  netQuantity: number;
  openedAt: string;
  lastTradeAt: string;
  realizedPnl: string;
  tradingFees: string;
  expiration: {
    settlementPrice: string | null;
    settledAt: string | null;
  } | null;
  /// One fill, for `sessionIsLong`. Always length 1 unless the session has no
  /// fills at all, which the indexer does not produce.
  lastFill: { netQuantityAfter: number; tradeQuantity: number }[];
  user: {
    id: string;
  };
};

type PositionsBookResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  positions: PositionSessionRow[];
};
