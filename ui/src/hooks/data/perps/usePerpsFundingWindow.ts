import { useQuery, useQueryClient } from "@tanstack/react-query";
import { windowCutoffSeconds } from "../../../lib/portfolioPnl";
import { graphqlRequest } from "../graphql";
import { PerpsFundingWindowQuery } from "../queries/perps";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";

export const PERPS_FUNDING_WINDOW_QK = "PerpsFundingWindow";

/** Settled over the window, in USDC. Both halves are unsigned. */
export interface PaidReceived {
  paid: bigint;
  received: bigint;
}

/**
 * Perps funding and drift settled inside the realized-PnL window. Funding moves
 * the balance outside realized PnL; drift is folded into the entry, so it is
 * already inside it.
 */
export interface PerpsFundingWindow {
  funding: PaidReceived;
  drift: PaidReceived;
}

export type PerpsSettlementTotalsRow = {
  totalFundingPaid: string;
  totalFundingReceived: string;
  totalDriftPaid: string;
  totalDriftReceived: string;
};

/** The `me` slice and the four settlement baselines, batched or standalone. */
export interface PerpsFundingWindowRows {
  me?: PerpsSettlementTotalsRow | null;
  fundingPaidBaseline?: { cumulativeFundingPaid: string }[];
  fundingReceivedBaseline?: { cumulativeFundingReceived: string }[];
  driftPaidBaseline?: { cumulativeDriftPaid: string }[];
  driftReceivedBaseline?: { cumulativeDriftReceived: string }[];
}

/// No baseline row means nothing settled before the window, so all of it is inside.
const sinceBaseline = (lifetime: string, baseline: string | undefined): bigint =>
  BigInt(lifetime) - (baseline === undefined ? 0n : BigInt(baseline));

/// No `User` row means the account has never traded perps, so it has settled nothing.
export const mapPerpsFundingWindow = (rows: PerpsFundingWindowRows): PerpsFundingWindow => {
  const me = rows.me;
  if (!me) return { funding: { paid: 0n, received: 0n }, drift: { paid: 0n, received: 0n } };
  return {
    funding: {
      paid: sinceBaseline(me.totalFundingPaid, rows.fundingPaidBaseline?.[0]?.cumulativeFundingPaid),
      received: sinceBaseline(
        me.totalFundingReceived,
        rows.fundingReceivedBaseline?.[0]?.cumulativeFundingReceived,
      ),
    },
    drift: {
      paid: sinceBaseline(me.totalDriftPaid, rows.driftPaidBaseline?.[0]?.cumulativeDriftPaid),
      received: sinceBaseline(
        me.totalDriftReceived,
        rows.driftReceivedBaseline?.[0]?.cumulativeDriftReceived,
      ),
    },
  };
};

const fetchPerpsFundingWindow = async (address: `0x${string}`, cutoff: number) => {
  const response = await graphqlRequest<PerpsFundingWindowRows>(
    PerpsFundingWindowQuery,
    { address: address.toLowerCase(), cutoff: String(cutoff) },
    process.env.REACT_APP_SUBGRAPH_PERPS_URL,
  );
  return mapPerpsFundingWindow(response);
};

/// Kept fresh by `usePerpsSnapshot`, which writes this cache entry directly.
export const usePerpsFundingWindow = (address: `0x${string}` | undefined) => {
  const qc = useQueryClient();
  // Stable within the hour, so it can sit in the query key without churning.
  const cutoff = windowCutoffSeconds();
  return useQuery({
    queryKey: [PERPS_FUNDING_WINDOW_QK, address, cutoff],
    queryFn: () => {
      if (!address) throw new Error("usePerpsFundingWindow: address is required");
      return readViaSnapshot(qc, "perpetual", [PERPS_FUNDING_WINDOW_QK, address, cutoff], () =>
        fetchPerpsFundingWindow(address, cutoff),
      );
    },
    enabled: !!address,
    ...snapshotFedQueryOptions,
  });
};
