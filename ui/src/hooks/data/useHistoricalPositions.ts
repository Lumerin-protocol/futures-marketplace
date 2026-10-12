import { useQuery } from "@tanstack/react-query";
import { graphqlRequest } from "./graphql";
import { sessionIsLong } from "../../lib/positionDirection";
import { HistoricalPositionsQuery } from "./queries/futures";

export const HISTORICAL_POSITIONS_QK = "HistoricalPositions";

const PAGE_SIZE = 100;

export type HistoricalPosition = {
  id: string;
  timestamp: string;
  expirationAt: string;
  /// Session entry price (per day). Replaces the legacy buy/sell split — the
  /// session is owned by a single user, so a single price is sufficient and
  /// the side is conveyed via `isLong`.
  pricePerDay: bigint;
  /// Price the session actually exited at: the indexer's quantity-weighted
  /// average over every exit, whichever way they happened — traded out,
  /// liquidated, or cash-settled at expiry. Distinct from `settlementPrice`,
  /// which only exists for the last of those three. A session only reaches
  /// CLOSE through a path that folds into this, so it is always populated.
  closePrice: bigint;
  /// Realized PnL for the session as reported by the indexer. Replaces the
  /// legacy `buyerPnl` / `sellerPnl` split.
  pnl: number;
  /// Direction of the closed session, from `sessionIsLong`.
  ///
  /// A closed session is flat, so `netQuantity` cannot answer this; it is
  /// resolved from the one fill the query carries for the purpose.
  isLong: boolean;
  /// Cumulative qty closed during the session's lifetime (mirrors
  /// `PositionSession.closedQuantity` on the indexer).
  closedQuantity: number;
  /// Cumulative qty force-closed via liquidation during the session's lifetime
  /// (mirrors `PositionSession.liquidatedQuantity`). 0 if never liquidated.
  liquidatedQuantity: number;
  /// Peak net quantity reached during the session's lifetime (mirrors
  /// `PositionSession.maxQuantity` on the indexer). Documented upstream as
  /// signed, but arrives unsigned — its sign agreed with the session's actual
  /// direction in only 11 of 20 live sessions, i.e. no better than chance, so it
  /// is a size and nothing more. Use `Math.abs` for display, and `isLong` above
  /// for direction.
  maxQuantity: number;
  isActive: boolean;
  closedAt: string | null;
  /// Pinned cash-settlement price for this expiration (token decimals), or null.
  settlementPrice: bigint | null;
  /// Block timestamp at which the settlement price was pinned, or null.
  settledAt: string | null;
};

export type RawHistoricalPositionSession = {
  id: string;
  status: string;
  expirationAt: string;
  entryPrice: string;
  closePrice: string;
  closedQuantity: number;
  liquidatedQuantity: number;
  maxQuantity: number;
  openedAt: string;
  lastTradeAt: string;
  realizedPnl: string;
  tradingFees: string;
  expiration: {
    settlementPrice: string | null;
    settledAt: string | null;
  } | null;
  netQuantity: number;
  /// One fill, for `sessionIsLong`. Always length 1 unless the session has no
  /// fills at all, which the indexer does not produce.
  lastFill: { netQuantityAfter: number; tradeQuantity: number }[];
  user: {
    id: string;
  };
};

export type HistoricalPositionsResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  historyPositions: RawHistoricalPositionSession[];
};

/// Collapse a closed PositionSession into the HistoricalPosition shape. Price
/// comes from the session's `entryPrice` and PnL from `realizedPnl` — the row no
/// longer encodes a buyer/seller split since a session belongs to a single user.
///
/// A closed session is flat, so its direction comes from the single fill the
/// query carries for the purpose. Reading it off the *whole* fill history, which
/// is what this used to do, dwarfed everything else the UI fetched.
export const sessionToHistoricalPosition = (
  session: RawHistoricalPositionSession,
): HistoricalPosition => {
  const isLong = sessionIsLong(session.netQuantity, session.lastFill[0]);

  return {
    id: session.id,
    timestamp: session.openedAt,
    expirationAt: session.expirationAt,
    pricePerDay: BigInt(session.entryPrice),
    closePrice: BigInt(session.closePrice),
    pnl: Number(session.realizedPnl),
    isLong,
    closedQuantity: session.closedQuantity,
    liquidatedQuantity: session.liquidatedQuantity,
    maxQuantity: session.maxQuantity,
    isActive: false,
    closedAt: session.lastTradeAt,
    settlementPrice:
      session.expiration && session.expiration.settlementPrice != null
        ? BigInt(session.expiration.settlementPrice)
        : null,
    settledAt: session.expiration?.settledAt ?? null,
  };
};

const fetchAllHistoricalPositions = async (
  address: `0x${string}`,
): Promise<{
  data: HistoricalPosition[];
  blockNumber: number;
}> => {
  let allPositions: HistoricalPosition[] = [];
  let skip = 0;
  let hasMore = true;
  let blockNumber = 0;

  while (hasMore) {
    const variables = {
      address: address.toLowerCase(),
      historyFirst: PAGE_SIZE,
      historySkip: skip,
    };

    const response = await graphqlRequest<HistoricalPositionsResponse>(
      HistoricalPositionsQuery,
      variables,
    );

    blockNumber = response._meta.block.number;

    allPositions = allPositions.concat(
      response.historyPositions.map(sessionToHistoricalPosition),
    );

    if (response.historyPositions.length < PAGE_SIZE) {
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
    queryFn: () => {
      if (!address) throw new Error("useHistoricalPositions: address is required");
      return fetchAllHistoricalPositions(address);
    },
    enabled: !!address && enabled,
    staleTime: 60 * 1000, // 1 minute
  });
};
