import { useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import { useFuturePaymentToken } from "./useFuturePaymentToken";

/**
 * Hook to get futures payment token info (name, symbol, decimals)
 */
export function useFuturesTokenInfo() {
  const { data: tokenAddress } = useFuturePaymentToken();

  const result = useReadContracts({
    contracts: [
      {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "name",
      },
      {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "symbol",
      },
      {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "decimals",
      },
    ],
    query: {
      enabled: !!tokenAddress,
      staleTime: Number.POSITIVE_INFINITY, // Token info doesn't change
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