import { useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import { usePerpsPaymentToken } from "./usePerpsPaymentToken";
import { withErrors } from "../../../lib/withErrors";

export function usePerpsTokenInfo() {
  const { data: tokenAddress } = usePerpsPaymentToken();

  const result = useReadContracts({
    contracts: [
      {
        address: tokenAddress as `0x${string}`,
        abi: withErrors(erc20Abi),
        functionName: "name",
      },
      {
        address: tokenAddress as `0x${string}`,
        abi: withErrors(erc20Abi),
        functionName: "symbol",
      },
      {
        address: tokenAddress as `0x${string}`,
        abi: withErrors(erc20Abi),
        functionName: "decimals",
      },
    ],
    query: {
      enabled: !!tokenAddress,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  });

  const name = result.data?.[0]?.result as string | undefined;
  const symbol = result.data?.[1]?.result as string | undefined;
  const decimals = result.data?.[2]?.result as number | undefined;

  return {
    ...result,
    tokenAddress,
    name,
    symbol,
    decimals,
  };
}
