import { useQuery } from "@tanstack/react-query";
import { graphqlRequest } from "./graphql";
import { SessionTradesQuery } from "./queries/futures";
import {
  toFuturesSessionTrade,
  type FuturesSessionTrade,
  type RawSessionTrade,
} from "./getUserFuturesPositions";

export const SESSION_TRADES_QK = "SessionTrades";

type SessionTradesResponse = {
  sessionTrades: { id: string; trades: RawSessionTrade[] }[];
};

/// The fills belonging to the given position sessions, keyed by session id.
///
/// Fills are the heaviest thing the futures subgraph serves and only one screen
/// renders them, so no session query selects them; this hook is how they get in.
/// Call it with the sessions actually on screen and leave it disabled until then.
export const useSessionTrades = (sessionIds: string[], enabled: boolean = false) => {
  // Sorted so that two selections covering the same sessions in a different
  // order share one cache entry rather than fetching twice.
  const ids = [...sessionIds].sort();

  return useQuery({
    queryKey: [SESSION_TRADES_QK, ids],
    queryFn: async () => {
      const response = await graphqlRequest<SessionTradesResponse>(SessionTradesQuery, { sessionIds: ids });
      const bySession = new Map<string, FuturesSessionTrade[]>();
      for (const session of response.sessionTrades) {
        bySession.set(session.id, session.trades.map(toFuturesSessionTrade));
      }
      return bySession;
    },
    enabled: enabled && ids.length > 0,
    // Fills are immutable once indexed, and a session only ever gains them. An
    // open modal is not worth polling for that.
    staleTime: 60 * 1000,
  });
};
