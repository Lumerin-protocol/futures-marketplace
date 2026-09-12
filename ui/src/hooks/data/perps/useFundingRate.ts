import { graphqlRequest } from "../graphql";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";
import { FundingUpdatesQuery } from "../queries/perps";

export const FUNDING_RATE_QK = "FundingRate";

/// Kept fresh by `usePerpsSnapshot`, which writes this cache entry directly.
export const useFundingRate = () => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [FUNDING_RATE_QK],
    queryFn: () => readViaSnapshot(qc, "perpetual", [FUNDING_RATE_QK], fetchFundingRateAsync),
    ...snapshotFedQueryOptions,
  });

  return query;
};

const fetchFundingRateAsync = async () => {
  const response = await graphqlRequest<FundingUpdatesResponse>(
    FundingUpdatesQuery,
    {},
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  return mapFundingRate(response.funding);
};

/// Shared with `PerpsSnapshotQuery`'s `funding` alias, which writes this cache
/// entry directly. Both paths must produce identical shapes.
export const mapFundingRate = (rows: FundingUpdateRow[] | null) => {
  if (!rows || rows.length === 0) {
    return {
      data: null,
      formattedRate: "0%",
    };
  }

  const latestUpdate = rows[0];

  // Apply formula: fundingRate / 10**18
  const fundingRateBigInt = BigInt(latestUpdate.fundingRate);
  const divisor = BigInt(10 ** 18);
  const fundingRateDecimal = Number(fundingRateBigInt) / Number(divisor);

  // Format as percentage (multiply by 100 and add % sign)
  const formattedRate = `${(fundingRateDecimal * 100).toFixed(4)}%`;

  const data: FundingUpdate = {
    blockNumber: Number(latestUpdate.blockNumber),
    cumulativeFundingPerUnit: BigInt(latestUpdate.cumulativeFundingPerUnit),
    fundingRate: fundingRateBigInt,
    id: latestUpdate.id,
    timestamp: Number(latestUpdate.timestamp),
    transactionHash: latestUpdate.transactionHash,
  };

  return {
    data,
    formattedRate,
  };
};

export type FundingUpdate = {
  blockNumber: number;
  cumulativeFundingPerUnit: bigint;
  fundingRate: bigint;
  id: string;
  timestamp: number;
  transactionHash: string;
};

export type FundingUpdateRow = {
  blockNumber: string;
  cumulativeFundingPerUnit: string;
  fundingRate: string;
  id: string;
  timestamp: string;
  transactionHash: string;
};

type FundingUpdatesResponse = {
  funding: FundingUpdateRow[];
};
