import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { sumUnrealizedPnl, type UnrealizedLeg } from "../../../lib/portfolioPnl";
import { backgroundRefetchOpts } from "../config";
import { useGetMarketPrice } from "../useGetMarketPrice";
import { aggregateVenuePnl, type VenuePnlAggregate } from "./aggregate";
import type { OpenPositionLeg } from "./exposure";
import { PNL_VENUES } from "./venues";

export const PORTFOLIO_OPEN_EXPOSURE_QK = "PortfolioOpenExposure";

const priceLegs = (legs: OpenPositionLeg[], markPrice: bigint): UnrealizedLeg[] =>
  legs.map((leg) => ({
    netQuantity: leg.netQuantity,
    entryPrice: leg.entryPrice,
    markPrice: leg.settlementPrice ?? markPrice,
    quantityScale: leg.quantityScale,
  }));

/**
 * The account's unrealized PnL on open positions, summed across venues.
 *
 * Exposure and price are read separately: the subgraph reads refresh on the slow
 * background interval while the mark polls every 10s, and pricing happens here
 * so a price tick re-values the book without re-fetching it.
 */
export function usePortfolioUnrealizedPnl(
  address: `0x${string}` | undefined,
): VenuePnlAggregate {
  const { data: markPrice } = useGetMarketPrice();

  const results = useQueries({
    queries: PNL_VENUES.map((venue) => ({
      queryKey: [PORTFOLIO_OPEN_EXPOSURE_QK, venue.id, address],
      queryFn: () => {
        if (!address) throw new Error("usePortfolioUnrealizedPnl: address is required");
        return venue.fetchOpenExposure({
          address,
          subgraphUrl: venue.subgraphUrl,
          quantityScale: venue.quantityScale,
        });
      },
      enabled: !!address,
      ...backgroundRefetchOpts,
    })),
  });

  const venueIds = useMemo(() => PNL_VENUES.map((venue) => venue.id), []);

  // A zero mark means the oracle read came back unusable, not that the book is
  // worth nothing; pricing against it would post a loss the size of the whole
  // position. Treat it as no mark at all and report nothing.
  const hasMark = markPrice !== undefined && markPrice > 0n;

  const priced = results.map((result) => ({
    // Without a mark there is no PnL to state, so the venue reads as unreported
    // rather than as zero.
    data:
      hasMark && result.data !== undefined
        ? sumUnrealizedPnl(priceLegs(result.data, markPrice))
        : undefined,
    isError: result.isError,
    isFetching: result.isFetching,
  }));

  return aggregateVenuePnl(priced, venueIds);
}
