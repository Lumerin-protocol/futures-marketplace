import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deriveMarginFigures,
  marginStatusCopy,
  nextTier,
  type MarginTier,
} from "../../lib/marginRisk";
import type { RiskToastItem } from "../../components/Widgets/Futures/RiskToast";
import { useGetFutureBalance } from "./useGetFutureBalance";
import { useGetPortfolioMargins } from "./useGetPortfolioMargins";
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

  const balance = balanceQuery.data as bigint | undefined;
  const { im, mm } = marginsQuery;
  const { netUnrealizedPnl, unrealizedLossTerm } = venuePnl;

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
      unrealizedLossTerm === null
    ) {
      return null;
    }
    return deriveMarginFigures({ balance, im, mm, netUnrealizedPnl, unrealizedLossTerm });
  }, [balance, im, mm, netUnrealizedPnl, unrealizedLossTerm]);

  const ratioPercent = figures?.ratioPercent ?? null;

  const [tier, setTier] = useState<MarginTier>("healthy");
  const [toasts, setToasts] = useState<RiskToastItem[]>([]);
  const tierRef = useRef<MarginTier>("healthy");
  const toastedTiers = useRef<Set<MarginTier>>(new Set());
  const addressRef = useRef(address);

  useEffect(() => {
    // A wallet switch starts a new session: the previous account's tier is not
    // a hysteresis floor for this one, and its toasts have already been read.
    // Handled inside the ladder rather than in its own effect so the incoming
    // account is graded in the same pass — two accounts can share a ratio, and
    // resetting alone would leave the tier stuck at healthy until it moved.
    if (addressRef.current !== address) {
      addressRef.current = address;
      tierRef.current = "healthy";
      toastedTiers.current.clear();
      setToasts([]);
    }

    const previous = tierRef.current;
    const resolved = nextTier(previous, ratioPercent);
    tierRef.current = resolved;
    setTier(resolved);
    if (resolved === previous) return;

    if (!TOASTED_TIERS.includes(resolved) || toastedTiers.current.has(resolved)) return;
    const message = marginStatusCopy(resolved, { ratioPercent, liqPrice });
    if (!message) return;
    // Once per tier per session: the banner is what persists, and a toast every
    // poll while the ratio hovers on a boundary would be unusable.
    toastedTiers.current.add(resolved);
    setToasts((prev) => [{ id: `margin:${resolved}`, message, variant: "danger" }, ...prev]);
  }, [address, ratioPercent, liqPrice]);

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
    isError: balanceQuery.isError || marginsQuery.isError || venuePnl.isError,
    refetch,
    toasts,
    dismissToast,
  };
}
