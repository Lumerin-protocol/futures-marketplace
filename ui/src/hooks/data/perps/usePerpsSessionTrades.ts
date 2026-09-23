import { useQuery } from "@tanstack/react-query";
import { graphqlRequest } from "../graphql";
import { PerpsSessionTradesQuery } from "../queries/perps";
import type { Trade } from "./useUserPositionSessions";

export const PERPS_SESSION_TRADES_QK = "PerpsSessionTrades";

type RawPerpsSessionTrade = {
  aggregatedEntryPriceAfter: string;
  blockNumber: string;
  id: string;
  netQuantityAfter: string;
  realizedPnl: string;
  timestamp: string;
  tradePrice: string;
  tradeQuantity: string;
  tradingFee: string;
  transactionHash: string;
};

type PerpsSessionTradesResponse = {
  sessionTrades: { id: string; trades: RawPerpsSessionTrade[] }[];
};

const toTrade = (trade: RawPerpsSessionTrade): Trade => ({
  aggregatedEntryPriceAfter: BigInt(trade.aggregatedEntryPriceAfter),
  blockNumber: Number(trade.blockNumber),
  id: trade.id,
  netQuantityAfter: BigInt(trade.netQuantityAfter),
  realizedPnl: BigInt(trade.realizedPnl),
  timestamp: trade.timestamp,
  tradePrice: BigInt(trade.tradePrice),
  tradeQuantity: BigInt(trade.tradeQuantity),
  tradingFee: BigInt(trade.tradingFee),
  transactionHash: trade.transactionHash,
});

/**
 * The fills of one perps session, fetched when its trade-details modal opens.
 *
 * The sessions themselves carry a single fill, for direction. Carrying all of
 * them cost far more — they ride the 5-second tick and grow with every fill the
 * account has ever made — for something only this modal renders.
 */
export const usePerpsSessionTrades = (sessionId: string | undefined) =>
  useQuery({
    queryKey: [PERPS_SESSION_TRADES_QK, sessionId],
    queryFn: async () => {
      const response = await graphqlRequest<PerpsSessionTradesResponse>(
        PerpsSessionTradesQuery,
        { sessionIds: [sessionId] },
        process.env.REACT_APP_SUBGRAPH_PERPS_URL,
      );
      return (response.sessionTrades[0]?.trades ?? []).map(toTrade);
    },
    enabled: !!sessionId,
    // Fills are immutable once indexed, and a session only ever gains them. An
    // open modal is not worth polling for that.
    staleTime: 60 * 1000,
  });
