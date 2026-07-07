import { useReadContracts } from "wagmi";
import { IPortfolioMarginEngineAbi } from "../../abi/IPortfolioMarginEngine";
import { useFuturesMarginEngine } from "./useFuturesMarginEngine";

/// Reads the four risk-shock parameters from the `IPortfolioMarginEngine`
/// contract resolved via the Futures contract's immutable `marginEngine`
/// address. Values are WAD-scaled (1e18) fractions used by the portfolio
/// margin stress model (spot shocks and vol shocks for IM and MM).
export function useMarginEngineShocks() {
  const { data: engine } = useFuturesMarginEngine();

  const result = useReadContracts({
    contracts: [
      { address: engine, abi: IPortfolioMarginEngineAbi, functionName: "imSpotShock" },
      { address: engine, abi: IPortfolioMarginEngineAbi, functionName: "mmSpotShock" },
      { address: engine, abi: IPortfolioMarginEngineAbi, functionName: "imVolShock" },
      { address: engine, abi: IPortfolioMarginEngineAbi, functionName: "mmVolShock" },
    ],
    query: {
      enabled: !!engine,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });

  return {
    ...result,
    imSpotShock: result.data?.[0]?.result as bigint | undefined,
    mmSpotShock: result.data?.[1]?.result as bigint | undefined,
    imVolShock: result.data?.[2]?.result as bigint | undefined,
    mmVolShock: result.data?.[3]?.result as bigint | undefined,
  };
}
