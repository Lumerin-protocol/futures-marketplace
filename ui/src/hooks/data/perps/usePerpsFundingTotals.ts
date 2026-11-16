import { useQuery, useQueryClient } from "@tanstack/react-query";
import { graphqlRequest } from "../graphql";
import { PerpsOpenExposureQuery } from "../queries/perps";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";

export const PERPS_FUNDING_TOTALS_QK = "PerpsFundingTotals";

/** Lifetime settled funding on perps, in USDC. Both halves are unsigned. */
export interface PerpsFundingTotals {
  paid: bigint;
  received: bigint;
}

export type PerpsFundingTotalsRow = { totalFundingPaid: string; totalFundingReceived: string };

/// Fed by the perps `me` slice, batched or standalone. No `User` row means the
/// account has never traded perps, so it has settled no funding.
export const mapPerpsFundingTotals = (user: PerpsFundingTotalsRow | null): PerpsFundingTotals =>
  user
    ? { paid: BigInt(user.totalFundingPaid), received: BigInt(user.totalFundingReceived) }
    : { paid: 0n, received: 0n };

const fetchPerpsFundingTotals = async (address: `0x${string}`) => {
  const response = await graphqlRequest<{ me: PerpsFundingTotalsRow | null }>(
    PerpsOpenExposureQuery,
    { address: address.toLowerCase() },
    process.env.REACT_APP_SUBGRAPH_PERPS_URL,
  );
  return mapPerpsFundingTotals(response.me);
};

/// Kept fresh by `usePerpsSnapshot`, which writes this cache entry directly.
export const usePerpsFundingTotals = (address: `0x${string}` | undefined) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: [PERPS_FUNDING_TOTALS_QK, address],
    queryFn: () => {
      if (!address) throw new Error("usePerpsFundingTotals: address is required");
      return readViaSnapshot(qc, "perpetual", [PERPS_FUNDING_TOTALS_QK, address], () =>
        fetchPerpsFundingTotals(address),
      );
    },
    enabled: !!address,
    ...snapshotFedQueryOptions,
  });
};
