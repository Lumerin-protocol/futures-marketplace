import { backgroundRefetchOpts } from "../config";
import { graphqlRequest } from "../graphql";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { FundingUpdatesQuery } from "./graphql-queries";

export const FUNDING_RATE_QK = "FundingRate";

export const useFundingRate = (props?: { refetch?: boolean }) => {
  const query = useQuery({
    queryKey: [FUNDING_RATE_QK],
    queryFn: () => fetchFundingRateAsync(),
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchFundingRateAsync = async () => {
  const response = await graphqlRequest<FundingUpdatesResponse>(
    FundingUpdatesQuery,
    {},
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  if (!response.fundingUpdates || response.fundingUpdates.length === 0) {
    return {
      data: null,
      formattedRate: "0%",
    };
  }

  const latestUpdate = response.fundingUpdates[0];

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

type FundingUpdatesResponse = {
  fundingUpdates: {
    blockNumber: string;
    cumulativeFundingPerUnit: string;
    fundingRate: string;
    id: string;
    timestamp: string;
    transactionHash: string;
  }[];
};
