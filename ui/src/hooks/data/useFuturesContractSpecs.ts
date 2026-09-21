import { backgroundRefetchOpts } from "./config";
import { graphqlRequest } from "./graphql";
import { useQuery } from "@tanstack/react-query";
import type { GetResponse } from "../../gateway/interfaces";
import { ContractSpecsQuery } from "./graphql-queries";

export const FUTURES_CONTRACT_SPECS_QK = "ContractSpecs";

export const useFuturesContractSpecs = (props?: { refetch?: boolean }) => {
  const query = useQuery({
    queryKey: [FUTURES_CONTRACT_SPECS_QK],
    queryFn: fetchContractSpecsAsync,
    ...(props?.refetch ? backgroundRefetchOpts : {}),
  });

  return query;
};

const fetchContractSpecsAsync = async (): Promise<GetResponse<FuturesContractSpecs>> => {
  const response = await graphqlRequest<ContractSpecsResponse>(ContractSpecsQuery);
  const data: FuturesContractSpecs = {
    priceOracle: response.futures.priceOracle,
    minimumPriceIncrement: BigInt(response.futures.minimumPriceIncrement),
    contractSizeHpsDay: BigInt(+response.futures.contractSizeHpsDay),
    tokenAddress: response.futures.contractAddress,
  };
  return {
    data,
    blockNumber: response._meta.block.number,
  };
};

export type FuturesContractSpecs = {
  priceOracle: `0x${string}`;
  minimumPriceIncrement: bigint;
  contractSizeHpsDay: bigint;
  tokenAddress: `0x${string}`;
};

type ContractSpecsResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  futures: {
    priceOracle: `0x${string}`;
    minimumPriceIncrement: string;
    contractSizeHpsDay: string;
    contractAddress: `0x${string}`;
  };
};
