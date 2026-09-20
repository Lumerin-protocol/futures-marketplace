import { useQuery, useQueryClient } from "@tanstack/react-query";
import { snapshotFedQueryOptions } from "./snapshot/config";
import { readViaSnapshot } from "./snapshot/snapshotFed";
import { graphqlRequest } from "./graphql";
import { RecentTradesQuery } from "./queries/futures";
import type { ContractMode } from "../../types/types";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE_NUM } from "../../lib/units";

export const RECENT_TRADES_QK = "RecentTrades";

/// Page size for the public trades tab. Part of the query key, so the venue
/// snapshots must use the same value to write the entry the tab reads.
export const RECENT_TRADES_DEFAULT_FIRST = 50;

// One normalized public trade for the order book "Trades" tab.
export type RecentTrade = {
  id: string;
  // Aggressor side derived from the signed on-chain `tradeQuantity`.
  side: "buy" | "sell";
  // Fill price in payment-token units (USDHL/USDC).
  price: number;
  // Absolute contract quantity.
  quantity: number;
  // Notional value of the fill (price * quantity), in payment-token units.
  size: number;
  transactionHash: `0x${string}`;
  // Unix timestamp in seconds.
  timestamp: number;
};

/// Kept fresh by the venue snapshot, which writes this cache entry directly for
/// the default page size.
export const useRecentTrades = (
  contractMode: ContractMode = "futures",
  props?: {
    first?: number;
  },
) => {
  const first = props?.first ?? RECENT_TRADES_DEFAULT_FIRST;
  const subgraphUrl =
    contractMode === "perpetual"
      ? process.env.REACT_APP_SUBGRAPH_PERPS_URL
      : process.env.REACT_APP_SUBGRAPH_FUTURES_URL;

  const quantityScale = recentTradeQuantityScale(contractMode);
  const qc = useQueryClient();

  return useQuery({
    queryKey: [RECENT_TRADES_QK, contractMode, first],
    queryFn: () =>
      readViaSnapshot(qc, contractMode, [RECENT_TRADES_QK, contractMode, first], async () => {
        const response = await graphqlRequest<RecentTradesResponse>(
          RecentTradesQuery,
          { first },
          subgraphUrl,
        );

        return mapRecentTrades(response.recentTrades, quantityScale);
      }),
    ...snapshotFedQueryOptions,
  });
};

/// Quantity scale for a venue's raw `tradeQuantity`: perps carry decimals,
/// futures contracts are whole units.
export const recentTradeQuantityScale = (contractMode: ContractMode): number =>
  contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;

/// Shared with the venue snapshot queries' `recentTrades` alias, which write this
/// cache entry directly. Both paths must produce identical shapes.
export const mapRecentTrades = (
  rows: RecentTradeRow[],
  quantityScale: number,
): RecentTrade[] =>
  rows.map((trade) => {
    const signedQuantity = Number(trade.tradeQuantity) / quantityScale;
    const quantity = Math.abs(signedQuantity);
    // Some rows carry a signed tradePrice; the fill price for display is
    // always positive, side is derived from the signed quantity instead.
    const price = Math.abs(Number(trade.tradePrice)) / PAYMENT_TOKEN_SCALE_NUM;
    return {
      id: trade.id,
      side: signedQuantity >= 0 ? "buy" : "sell",
      price,
      quantity,
      size: quantity * price,
      transactionHash: trade.transactionHash as `0x${string}`,
      timestamp: Number(trade.timestamp),
    };
  });

export type RecentTradeRow = {
  id: string;
  tradePrice: string;
  tradeQuantity: string;
  timestamp: string;
  transactionHash: string;
};

type RecentTradesResponse = {
  recentTrades: RecentTradeRow[];
};
