import { snapshotFedQueryOptions } from "./snapshot/config";
import { graphqlRequest } from "./graphql";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readViaSnapshot } from "./snapshot/snapshotFed";
import type { GetResponse } from "../../gateway/interfaces";
import { ContractSpecsQuery } from "./queries/futures";

export const FUTURES_CONTRACT_SPECS_QK = "ContractSpecs";

/// Kept fresh by `useFuturesSnapshot`, which writes this cache entry directly.
export const useFuturesContractSpecs = () => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [FUTURES_CONTRACT_SPECS_QK],
    queryFn: () =>
      readViaSnapshot(qc, "futures", [FUTURES_CONTRACT_SPECS_QK], fetchContractSpecsAsync),
    ...snapshotFedQueryOptions,
  });

  return query;
};

/// Shared with `FuturesSnapshotQuery`'s `specs` alias, which writes this cache
/// entry directly. Both paths must produce identical shapes.
export const mapContractSpecs = (row: ContractSpecsRow): FuturesContractSpecs => ({
  priceOracle: row.priceOracle,
  minimumPriceIncrement: BigInt(row.minimumPriceIncrement),
  contractSizeHpsDay: BigInt(+row.contractSizeHpsDay),
  tokenAddress: row.contractAddress,
});

const fetchContractSpecsAsync = async (): Promise<GetResponse<FuturesContractSpecs>> => {
  const response = await graphqlRequest<ContractSpecsResponse>(ContractSpecsQuery);
  return {
    data: mapContractSpecs(response.specs),
    blockNumber: response._meta.block.number,
  };
};

export type FuturesContractSpecs = {
  priceOracle: `0x${string}`;
  minimumPriceIncrement: bigint;
  contractSizeHpsDay: bigint;
  tokenAddress: `0x${string}`;
};

export type ContractSpecsRow = {
  priceOracle: `0x${string}`;
  minimumPriceIncrement: string;
  contractSizeHpsDay: string;
  contractAddress: `0x${string}`;
};

type ContractSpecsResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  specs: ContractSpecsRow;
};
