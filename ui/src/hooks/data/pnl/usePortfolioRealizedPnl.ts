import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { realizedPnlSinceBaseline, windowCutoffSeconds } from "../../../lib/portfolioPnl";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";
import { graphqlRequest } from "../graphql";
import { aggregateVenuePnl, type VenuePnlAggregate } from "./aggregate";
import { VenueRealizedPnlQuery } from "../queries/futures";
import { PNL_VENUES, type ConfiguredPnlVenue } from "./venues";

export const PORTFOLIO_REALIZED_PNL_QK = "PortfolioRealizedPnl";

interface VenueRealizedPnlResponse {
  me: { realizedPnl: string } | null;
  realizedBaseline: { cumulativeRealizedPnl: string }[];
}

const fetchVenueRealizedPnl = async (
  venue: ConfiguredPnlVenue,
  address: `0x${string}`,
  cutoff: number,
): Promise<bigint> => {
  const response = await graphqlRequest<VenueRealizedPnlResponse>(
    VenueRealizedPnlQuery,
    { address: address.toLowerCase(), cutoff: String(cutoff) },
    venue.subgraphUrl,
  );

  // No `User` row means the account has never traded this venue.
  if (!response.me) return 0n;

  const baseline =
    response.realizedBaseline.length > 0
      ? BigInt(response.realizedBaseline[0].cumulativeRealizedPnl)
      : null;

  return realizedPnlSinceBaseline(BigInt(response.me.realizedPnl), baseline);
};

/**
 * The account's realized PnL over the trailing window, summed across venues.
 *
 * Each venue costs two rows: its lifetime total and the cumulative snapshot
 * carried by the newest trade before the window. That is what makes the header
 * affordable on every page — the alternative is paging the account's entire
 * closed history just to add it back up on the client.
 */
export function usePortfolioRealizedPnl(
  address: `0x${string}` | undefined,
): VenuePnlAggregate {
  // Stable within the hour, so it can sit in the query key without churning.
  const cutoff = windowCutoffSeconds();

  const qc = useQueryClient();

  const results = useQueries({
    queries: PNL_VENUES.map((venue) => ({
      queryKey: [PORTFOLIO_REALIZED_PNL_QK, venue.id, address, cutoff],
      queryFn: () => {
        if (!address) throw new Error("usePortfolioRealizedPnl: address is required");
        return readViaSnapshot(
          qc,
          venue.id,
          [PORTFOLIO_REALIZED_PNL_QK, venue.id, address, cutoff],
          () => fetchVenueRealizedPnl(venue, address, cutoff),
        );
      },
      enabled: !!address,
      ...snapshotFedQueryOptions,
    })),
  });

  const venueIds = useMemo(() => PNL_VENUES.map((venue) => venue.id), []);

  return aggregateVenuePnl(results, venueIds);
}
