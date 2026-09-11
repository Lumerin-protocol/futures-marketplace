import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MARGIN_RATIO_THRESHOLDS,
  deriveMarginFigures,
  marginStatusCopy,
  type MarginShocks,
  marginTier,
  thresholdsFromShocks,
  type MarginTier,
} from "../../lib/marginRisk";
import type { RiskToastItem } from "../../components/Widgets/Futures/RiskToast";
import { useGetFutureBalance } from "./useGetFutureBalance";
import { useGetPortfolioMargins } from "./useGetPortfolioMargins";
import { useMarginEngineShocks } from "./useMarginEngineShocks";
import { useVenueUnrealizedPnl } from "./useVenueUnrealizedPnl";

/// Tiers urgent enough to interrupt: Caution is a border and a status line, but
/// a user who is one move from liquidation should be told even if the panel is
/// scrolled out of view.
const TOASTED_TIERS: readonly MarginTier[] = ["danger", "liquidatable"];

export interface MarginRiskState {
  /// Initial margin. Drives the withdrawal cap and every order-entry check.
  im: bigint | null;
  /// Maintenance margin. Drives the risk ladder and nothing else.
  mm: bigint | null;
  equity: bigint | null;
  marginUsed: bigint | null;
  available: bigint | null;
  ratioPercent: number | null;
  belowIM: boolean;
  tier: MarginTier;
  /// No figures yet. The panel shows placeholders rather than a spinner.
  isLoading: boolean;
  /// Figures on screen and a background poll in flight.
  isRefreshing: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  toasts: RiskToastItem[];
  dismissToast: (id: string) => void;
}

/// Everything the account portfolio panel reads, in one place.
///
/// The three reads are separate because they poll at their own cadences and fail
/// independently, but the panel's figures only make sense together — Margin Used
/// subtracts a risk-view term from a margin-engine figure — so they are combined
/// once here rather than in the widget.
///
/// `liqPrice` is threaded in only for the Danger copy; the tier itself is decided
/// by the margin ratio.
export function useMarginRisk(
  address: `0x${string}` | undefined,
  liqPrice?: bigint,
): MarginRiskState {
  // Same query key as the page's own balance read, so this is a cache hit rather
  // than a second RPC.
  const balanceQuery = useGetFutureBalance(address);
  const marginsQuery = useGetPortfolioMargins(address);
  const venuePnl = useVenueUnrealizedPnl(address);
  // Read once and cached: the ratio needs the shocks to split IM/MM into stress
  // and loss, and the tier boundaries are constants of the same shocks.
  const shocksQuery = useMarginEngineShocks();

  const balance = balanceQuery.data as bigint | undefined;
  const { im, mm } = marginsQuery;
  const { netUnrealizedPnl, unrealizedLossTerm } = venuePnl;
  const { imSpotShock, mmSpotShock } = shocksQuery;

  const shocks = useMemo<MarginShocks | null>(
    () => (imSpotShock !== undefined && mmSpotShock !== undefined ? { imSpotShock, mmSpotShock } : null),
    [imSpotShock, mmSpotShock],
  );
  const thresholds = useMemo(
    () => (shocks ? thresholdsFromShocks(shocks) : DEFAULT_MARGIN_RATIO_THRESHOLDS),
    [shocks],
  );

  // Equity is balance plus PnL and owes nothing to the margin engine, so it
  // keeps reporting when the engine read is the one that failed.
  const equity = useMemo(() => {
    if (balance === undefined || netUnrealizedPnl === null) return null;
    return balance + netUnrealizedPnl;
  }, [balance, netUnrealizedPnl]);

  const figures = useMemo(() => {
    if (
      balance === undefined ||
      im === undefined ||
      mm === undefined ||
      netUnrealizedPnl === null ||
      unrealizedLossTerm === null ||
      shocks === null
    ) {
      return null;
    }
    return deriveMarginFigures({ balance, im, mm, netUnrealizedPnl, unrealizedLossTerm, shocks });
  }, [balance, im, mm, netUnrealizedPnl, unrealizedLossTerm, shocks]);

  const ratioPercent = figures?.ratioPercent ?? null;
  const tier = useMemo(() => marginTier(ratioPercent, thresholds), [ratioPercent, thresholds]);

  const [toasts, setToasts] = useState<RiskToastItem[]>([]);
  const toastedTiers = useRef<Set<MarginTier>>(new Set());
  const addressRef = useRef(address);

  useEffect(() => {
    // A wallet switch starts a new session: the previous account's toasts have
    // already been read, and the incoming account earns its own.
    if (addressRef.current !== address) {
      addressRef.current = address;
      toastedTiers.current.clear();
      setToasts([]);
    }

    if (!TOASTED_TIERS.includes(tier) || toastedTiers.current.has(tier)) return;
    const message = marginStatusCopy(tier, { ratioPercent, liqPrice });
    if (!message) return;
    // Once per tier per session: the banner is what persists, and a toast every
    // poll while the ratio hovers on a boundary would be unusable.
    toastedTiers.current.add(tier);
    setToasts((prev) => [{ id: `margin:${tier}`, message, variant: "danger" }, ...prev]);
  }, [address, tier, ratioPercent, liqPrice]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const refetch = useCallback(() => marginsQuery.refetch(), [marginsQuery.refetch]);

  const isFetching = balanceQuery.isFetching || marginsQuery.isFetching || venuePnl.isFetching;

  return {
    im: im ?? null,
    mm: mm ?? null,
    equity,
    marginUsed: figures?.marginUsed ?? null,
    available: figures?.available ?? null,
    ratioPercent,
    belowIM: figures?.belowIM ?? false,
    tier,
    isLoading: figures === null && isFetching,
    isRefreshing: figures !== null && isFetching,
    isError: balanceQuery.isError || marginsQuery.isError || venuePnl.isError || shocksQuery.isError,
    refetch,
    toasts,
    dismissToast,
  };
}
