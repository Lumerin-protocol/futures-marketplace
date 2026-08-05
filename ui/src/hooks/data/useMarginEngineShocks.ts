import { useReadContracts } from "wagmi";
import { PortfolioMarginEngineAbi } from "collateral-margin-abi/PortfolioMarginEngine.ts";
import { useFuturesMarginEngine } from "./useFuturesMarginEngine";

/// Reads the four risk-shock parameters from the `PortfolioMarginEngine`
/// contract resolved via the Futures contract's `portfolioMargin` address.
/// Values are WAD-scaled (1e18) fractions used by the portfolio margin stress
/// model (spot shocks and vol shocks for IM and MM).
///
/// Read against the concrete engine rather than `IPortfolioMarginEngine`: the
/// interface carries only what the venues call, and the vol shocks are surfaced
/// for the shared risk-parameters panel, which covers options too.
export function useMarginEngineShocks() {
  const { data: engine } = useFuturesMarginEngine();

  const result = useReadContracts({
    contracts: [
      { address: engine, abi: PortfolioMarginEngineAbi, functionName: "imSpotShock" },
      { address: engine, abi: PortfolioMarginEngineAbi, functionName: "mmSpotShock" },
      { address: engine, abi: PortfolioMarginEngineAbi, functionName: "imVolShock" },
      { address: engine, abi: PortfolioMarginEngineAbi, functionName: "mmVolShock" },
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
