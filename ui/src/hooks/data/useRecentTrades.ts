import { useQuery } from "@tanstack/react-query";
import { backgroundRefetchOpts } from "./config";
import { graphqlRequest } from "./graphql";
import { RecentTradesQuery } from "./graphql-queries";
import type { ContractMode } from "../../types/types";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE_NUM } from "../../lib/units";
import { isBackstopAddress } from "./useProtocolBackstop";

export const RECENT_TRADES_QK = "RecentTrades";

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
  // Non-market prints: a forced liquidation close, or the protocol backstop's
  // side of one (hand-off at the mark, or a later unwind fill).
  tag?: "liquidation" | "backstop";
};

export const useRecentTrades = (
  contractMode: ContractMode = "futures",
  props?: {
    refetch?: boolean;
    first?: number;
  },
) => {
  const first = props?.first ?? 50;
  const subgraphUrl =
    contractMode === "perpetual"
      ? process.env.REACT_APP_SUBGRAPH_PERPS_URL
      : process.env.REACT_APP_SUBGRAPH_FUTURES_URL;

  // Perps quantities are QUANTITY_SCALE-scaled big ints; futures quantities are
  // raw contract counts.
  const quantityScale = contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;

  return useQuery({
    queryKey: [RECENT_TRADES_QK, contractMode, first],
    queryFn: async (): Promise<RecentTrade[]> => {
      const response = await graphqlRequest<RecentTradesResponse>(
        RecentTradesQuery,
        { first },
        subgraphUrl,
      );

      return response.trades.map((trade) => {
        const signedQuantity = Number(trade.tradeQuantity) / quantityScale;
        const quantity = Math.abs(signedQuantity);
        // Some rows carry a signed tradePrice; the fill price for display is
        // always positive, side is derived from the signed quantity instead.
        const price = Math.abs(Number(trade.tradePrice)) / PAYMENT_TOKEN_SCALE_NUM;
        const tag: RecentTrade["tag"] =
          trade.isBackstopAssignment || isBackstopAddress(trade.user?.id)
            ? "backstop"
            : trade.isLiquidation
              ? "liquidation"
              : undefined;
        return {
          id: trade.id,
          side: signedQuantity >= 0 ? "buy" : "sell",
          price,
          quantity,
          size: quantity * price,
          transactionHash: trade.transactionHash as `0x${string}`,
          timestamp: Number(trade.timestamp),
          ...(tag ? { tag } : {}),
        };
      });
    },
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });
};

type RecentTradesResponse = {
  trades: {
    id: string;
    tradePrice: string;
    tradeQuantity: string;
    timestamp: string;
    transactionHash: string;
    isLiquidation?: boolean;
    isBackstopAssignment?: boolean;
    user?: { id: string } | null;
  }[];
};
