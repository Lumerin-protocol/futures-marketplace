import useMediaQuery from "@mui/material/useMediaQuery";

// Breakpoint for the mobile-only compound trading layout (order book beside the
// place-order form). Above this width the standard desktop/tablet grid is used,
// including the existing 1024px single-column stack.
export const MOBILE_TRADING_QUERY = "(max-width: 768px)";

// Single source of truth for "is this the mobile trading layout?" so the mobile
// branch is greppable across the page and its widgets.
export const useIsMobileTradingLayout = (): boolean =>
  useMediaQuery(MOBILE_TRADING_QUERY, { noSsr: true });

// Shared metrics for the small segmented toggles that sit side by side in the
// mobile layout: the order book's Order Book / Trades switcher and the
// place-order form's Limit/Market, time-in-force and leverage toggles. Keeping
// them in one place is what makes the two columns line up.
export const MOBILE_TOGGLE_METRICS = `
  padding: 0.15rem 0.4rem;
  font-size: 0.62rem;
  line-height: 1.6;
  white-space: nowrap;
`;
