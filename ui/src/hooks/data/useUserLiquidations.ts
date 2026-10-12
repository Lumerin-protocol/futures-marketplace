import { useQueries, useQueryClient } from "@tanstack/react-query";
import { snapshotFedQueryOptions } from "./snapshot/config";
import { readViaSnapshot } from "./snapshot/snapshotFed";
import { graphqlRequest } from "./graphql";
import { UserFuturesLiquidationsQuery } from "./queries/futures";
import { UserPerpsLiquidationsQuery } from "./queries/perps";

export const USER_LIQUIDATIONS_QK = "UserLiquidations";

/// Enough to cover any plausible burst between two polls without approaching the
/// subgraph's 1000-row ceiling.
export const LIQUIDATIONS_FIRST = 25;

/// Shared with both venue snapshots' `liquidations` alias, which write these
/// cache entries directly. Both paths must produce identical shapes.
export const mapLiquidations = (
  rows: LiquidationRow[],
  product: UserLiquidation["product"],
): UserLiquidation[] => rows.map((trade) => ({ ...trade, product }));

export type UserLiquidation = {
  id: string;
  product: "perps" | "futures";
  timestamp: string;
  liquidator: string | null;
};

export type LiquidationRow = {
  id: string;
  timestamp: string;
  liquidator: string | null;
};

type LiquidationsResponse = {
  liquidations: LiquidationRow[];
};

/**
 * Watches both venues for the user's forced liquidations.
 *
 * Kept separate from `useUserFuturesTrades` / `useUserTrades` on purpose: those
 * are paginated infinite queries, and refetching one refetches every page it
 * holds, so polling them costs more the further the user has scrolled. These two
 * filter on `isLiquidation` server-side and cap at `LIQUIDATIONS_FIRST`, so the
 * cost of watching does not depend on what the history table is doing.
 *
 * Both entries are kept fresh by the venue snapshots, which write them directly.
 */
export const useUserLiquidations = (address?: `0x${string}`) => {
  const qc = useQueryClient();
  const [futures, perps] = useQueries({
    queries: [
      {
        queryKey: [USER_LIQUIDATIONS_QK, "futures", address],
        queryFn: () =>
          readViaSnapshot(qc, "futures", [USER_LIQUIDATIONS_QK, "futures", address], async () => {
            const response = await graphqlRequest<LiquidationsResponse>(
              UserFuturesLiquidationsQuery,
              { address: address?.toLowerCase(), liquidationsFirst: LIQUIDATIONS_FIRST },
            );
            return mapLiquidations(response.liquidations, "futures");
          }),
        enabled: !!address,
        ...snapshotFedQueryOptions,
      },
      {
        queryKey: [USER_LIQUIDATIONS_QK, "perpetual", address],
        queryFn: () =>
          readViaSnapshot(qc, "perpetual", [USER_LIQUIDATIONS_QK, "perpetual", address], async () => {
            const response = await graphqlRequest<LiquidationsResponse>(
              UserPerpsLiquidationsQuery,
              { address: address?.toLowerCase(), liquidationsFirst: LIQUIDATIONS_FIRST },
              process.env.REACT_APP_SUBGRAPH_PERPS_URL,
            );
            return mapLiquidations(response.liquidations, "perps");
          }),
        enabled: !!address,
        ...snapshotFedQueryOptions,
      },
    ],
  });

  return { futures, perps };
};
