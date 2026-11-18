import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { MarkRange } from "@hashpower/portfolio-margin";
import { sumUnrealizedPnl, type UnrealizedLeg } from "../../../lib/portfolioPnl";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";
import { useGetMarketPrice } from "../useGetMarketPrice";
import { usePortfolioSnapshot } from "../usePortfolioSnapshot";
import { aggregateVenuePnl, type VenuePnlAggregate } from "./aggregate";
import type { OpenPositionLeg } from "./exposure";
import { PNL_VENUES } from "./venues";

export const PORTFOLIO_OPEN_EXPOSURE_QK = "PortfolioOpenExposure";

/**
 * Each leg at the mark its venue values it at: a futures expiry at its range for the side
 * held (a long at `low`, a short at `high`), perps at its own mark (the glide), the index
 * where a mark has not loaded, and a pinned settlement price once recorded.
 */
const priceLegs = (
  legs: OpenPositionLeg[],
  isPerps: boolean,
  index: bigint,
  perpsMark: bigint | undefined,
  markRanges: ReadonlyMap<bigint, MarkRange> | undefined,
): UnrealizedLeg[] =>
  legs.map((leg) => {
    const range = leg.expirationAt !== undefined ? markRanges?.get(leg.expirationAt) : undefined;
    const live = isPerps
      ? (perpsMark ?? index)
      : ((leg.netQuantity > 0n ? range?.low : range?.high) ?? index);
    return {
      netQuantity: leg.netQuantity,
      entryPrice: leg.entryPrice,
      markPrice: leg.settlementPrice ?? live,
      quantityScale: leg.quantityScale,
    };
  });

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
  const { snapshot, markRanges } = usePortfolioSnapshot(address);
  const qc = useQueryClient();

  const results = useQueries({
    queries: PNL_VENUES.map((venue) => ({
      queryKey: [PORTFOLIO_OPEN_EXPOSURE_QK, venue.id, address],
      queryFn: () => {
        if (!address) throw new Error("usePortfolioUnrealizedPnl: address is required");
        return readViaSnapshot(
          qc,
          venue.id,
          [PORTFOLIO_OPEN_EXPOSURE_QK, venue.id, address],
          () =>
            venue.fetchOpenExposure({
              address,
              subgraphUrl: venue.subgraphUrl,
              quantityScale: venue.quantityScale,
            }),
        );
      },
      enabled: !!address,
      ...snapshotFedQueryOptions,
    })),
  });

  const venueIds = useMemo(() => PNL_VENUES.map((venue) => venue.id), []);

  // A zero mark means the oracle read came back unusable, not that the book is
  // worth nothing; pricing against it would post a loss the size of the whole
  // position. Treat it as no mark at all and report nothing.
  const hasMark = markPrice !== undefined && markPrice > 0n;

  const perpsMark = snapshot?.perp.mark;
  // The glide's drift not yet folded into the perps entry is part of that position's PnL.
  const pendingDrift = snapshot?.perp.pendingDrift ?? 0n;

  const priced = results.map((result, i) => {
    const isPerps = PNL_VENUES[i]?.id === "perpetual";
    return {
      // Without a mark there is no PnL to state, so the venue reads as unreported
      // rather than as zero.
      data:
        hasMark && result.data !== undefined
          ? sumUnrealizedPnl(priceLegs(result.data, isPerps, markPrice, perpsMark, markRanges)) +
            (isPerps ? pendingDrift : 0n)
          : undefined,
      isError: result.isError,
      isFetching: result.isFetching,
    };
  });

  return aggregateVenuePnl(priced, venueIds);
}
