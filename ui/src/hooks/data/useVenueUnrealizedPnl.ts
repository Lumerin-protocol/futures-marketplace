import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { PortfolioMarginEngineAbi } from "collateral-margin-abi/PortfolioMarginEngine.ts";
import { useFuturesMarginEngine } from "./useFuturesMarginEngine";
import { withErrors } from "../../lib/withErrors";

/// A single `useReadContracts` entry, narrowed to what we actually consume.
type ReadResult = { status: "success"; result: unknown } | { status: "failure" };

/// `ILinearMarket.getRiskView`, which every registered linear market implements
/// with the same tuple. Declared locally rather than reaching for the Futures or
/// Perps ABI: the markets are discovered by address, so there is no per-venue
/// ABI to pick, and only `unrealizedPnl` is read here.
const LINEAR_MARKET_RISK_VIEW_ABI = [
  {
    type: "function",
    name: "getRiskView",
    stateMutability: "view",
    inputs: [{ name: "_participant", type: "address" }],
    outputs: [
      {
        name: "view_",
        type: "tuple",
        components: [
          { name: "netPositionDelta", type: "int256" },
          { name: "unrealizedPnl", type: "int256" },
          { name: "pendingFunding", type: "int256" },
          { name: "buyOrderDelta", type: "uint256" },
          { name: "sellOrderDelta", type: "uint256" },
          { name: "buyOrderFillLoss", type: "uint256" },
          { name: "sellOrderFillLoss", type: "uint256" },
        ],
      },
    ],
  },
] as const;

interface VenueUnrealizedPnl {
  /// Account-wide unrealized PnL as the engine sees it, gains offsetting losses.
  netUnrealizedPnl: bigint | null;
  /// `Σ max(0, -unrealizedPnl)` clamped per market — the term IM charges for.
  unrealizedLossTerm: bigint | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
}

/// Unrealized PnL per linear market, in the two shapes the margin engine uses.
///
/// The IM path clamps each market's loss on its own and ignores gains, while the
/// account's actual PnL nets them; the portfolio panel needs both, because
/// `Margin Used` is IM with the clamped term removed and `Equity` is balance
/// plus the netted one.
///
/// Markets come from `getLinearMarkets()` rather than the two venue addresses in
/// env, so a newly registered market is charged for here the moment the engine
/// charges for it. The list is immutable in practice and cached indefinitely, so
/// the poll costs one multicall.
///
/// These reads also happen inside `usePortfolioSnapshot`, which discards the PnL
/// fields. They are repeated here rather than lifted out of it because that hook
/// resolves only once all six of its read waves succeed, and the panel's headline
/// figures should not blank out because a per-expiry settlement price failed.
export function useVenueUnrealizedPnl(address: `0x${string}` | undefined): VenueUnrealizedPnl {
  const { data: engine } = useFuturesMarginEngine();

  const marketsQuery = useReadContract({
    address: engine,
    abi: withErrors(PortfolioMarginEngineAbi),
    functionName: "getLinearMarkets",
    query: {
      enabled: !!engine,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });

  const markets = marketsQuery.data as readonly `0x${string}`[] | undefined;
  const hasMarkets = (markets?.length ?? 0) > 0;

  const riskViewsQuery = useReadContracts({
    contracts: (markets ?? []).map((market) => ({
      address: market,
      abi: withErrors(LINEAR_MARKET_RISK_VIEW_ABI),
      functionName: "getRiskView" as const,
      args: [address as `0x${string}`] as const,
    })),
    query: { enabled: !!address && hasMarkets, refetchInterval: 10_000 },
  });

  const reads = useMemo(() => {
    if (!markets) return { totals: undefined, failed: false };
    if (markets.length === 0) {
      return { totals: { netUnrealizedPnl: 0n, unrealizedLossTerm: 0n }, failed: false };
    }

    const results = riskViewsQuery.data as ReadResult[] | undefined;
    if (!results || results.length !== markets.length) {
      return { totals: undefined, failed: false };
    }

    let netUnrealizedPnl = 0n;
    let unrealizedLossTerm = 0n;
    for (const entry of results) {
      // A partial sum would understate the loss the engine is charging for and
      // overstate Margin Used, so one failed market drops the whole figure.
      if (entry.status !== "success") return { totals: undefined, failed: true };
      const { unrealizedPnl } = entry.result as { unrealizedPnl: bigint };
      netUnrealizedPnl += unrealizedPnl;
      if (unrealizedPnl < 0n) unrealizedLossTerm -= unrealizedPnl;
    }

    return { totals: { netUnrealizedPnl, unrealizedLossTerm }, failed: false };
  }, [markets, riskViewsQuery.data]);

  return {
    netUnrealizedPnl: reads.totals?.netUnrealizedPnl ?? null,
    unrealizedLossTerm: reads.totals?.unrealizedLossTerm ?? null,
    isLoading: marketsQuery.isLoading || (hasMarkets && riskViewsQuery.isLoading),
    isFetching: marketsQuery.isFetching || riskViewsQuery.isFetching,
    isError: marketsQuery.isError || riskViewsQuery.isError || reads.failed,
  };
}
