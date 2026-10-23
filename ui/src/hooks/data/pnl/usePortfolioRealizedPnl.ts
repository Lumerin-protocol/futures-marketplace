import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  realizedPnlAfterFees,
  realizedPnlSinceBaseline,
  windowCutoffSeconds,
} from "../../../lib/portfolioPnl";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";
import { graphqlRequest } from "../graphql";
import { aggregateVenuePnl, type VenuePnlAggregate } from "./aggregate";
import { VenueRealizedPnlQuery } from "../queries/futures";
import { PNL_VENUES, type ConfiguredPnlVenue } from "./venues";
import {
  FEES_FIRST_CURSOR,
  FEES_PAGE_SIZE,
  totalWindowFees,
  type WindowFeeRow,
} from "./windowFees";

export const PORTFOLIO_REALIZED_PNL_QK = "PortfolioRealizedPnl";

interface VenueRealizedPnlResponse {
  me: { realizedPnl: string } | null;
  realizedBaseline: { cumulativeRealizedPnl: string }[];
  feesInWindow: WindowFeeRow[];
}

const fetchVenueRealizedPnl = async (
  venue: ConfiguredPnlVenue,
  address: `0x${string}`,
  cutoff: number,
): Promise<bigint> => {
  const response = await graphqlRequest<VenueRealizedPnlResponse>(
    VenueRealizedPnlQuery,
    {
      address: address.toLowerCase(),
      cutoff: String(cutoff),
      feesFirst: FEES_PAGE_SIZE,
      feesAfterId: FEES_FIRST_CURSOR,
    },
    venue.subgraphUrl,
  );

  // No `User` row means the account has never traded this venue.
  if (!response.me) return 0n;

  const baseline =
    response.realizedBaseline.length > 0
      ? BigInt(response.realizedBaseline[0].cumulativeRealizedPnl)
      : null;

  return realizedPnlAfterFees(
    realizedPnlSinceBaseline(BigInt(response.me.realizedPnl), baseline),
    await totalWindowFees(response.feesInWindow, {
      address: address.toLowerCase(),
      cutoff,
      subgraphUrl: venue.subgraphUrl,
    }),
  );
};

/**
 * The account's realized PnL over the trailing window, net of the fees paid in
 * it, summed across venues.
 *
 * The PnL costs each venue two rows: its lifetime total and the cumulative
 * snapshot carried by the newest trade before the window. That is what makes the
 * header affordable on every page — the alternative is paging the account's
 * entire closed history just to add it back up on the client. Fees have no such
 * snapshot, so they come from the window's fee-bearing trades (`feesInWindow`).
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
