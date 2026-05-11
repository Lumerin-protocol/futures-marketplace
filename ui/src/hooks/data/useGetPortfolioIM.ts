import { useReadContract } from "wagmi";
import { IPortfolioMarginEngineAbi } from "../../abi/IPortfolioMarginEngine";
import { useFuturesMarginEngine } from "./useFuturesMarginEngine";

/// Reads the user's portfolio Initial Margin (IM) from the
/// `IPortfolioMarginEngine` contract resolved via the Futures contract's
/// immutable `marginEngine` address. This single value replaces the previous
/// per-engine aggregation (futures `getMinMargin` + perps `getInitialMargin` /
/// `getMaintenanceMargin`) and represents the total collateral locked across
/// open positions and resting orders.
export function useGetPortfolioIM(address: `0x${string}` | undefined) {
  const { data: engine } = useFuturesMarginEngine();
  return useReadContract({
    address: engine,
    abi: IPortfolioMarginEngineAbi,
    functionName: "computePortfolioIM",
    args: address ? [address] : undefined,
    query: {
      enabled: !!engine && !!address,
      refetchInterval: 10000,
    },
  });
}
