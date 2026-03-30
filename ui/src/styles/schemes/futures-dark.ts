/**
 * Compile-time color scheme for futures / dark trading UI.
 * All raw color literals for this theme should live here (or color-utils alpha()).
 */
export const futuresDark = {
  app: {
    bg: "#1e1e1e",
  },
  surface: {
    panel: "#1a1a1a",
    footer: "#1e2433",
    mobileTabBg: "#2f3639",
    mobileTabBgAlpha: "rgba(47, 54, 57, 0.95)",
    tabActive: "#4c5a5f",
    tabActiveRgb: "76, 90, 95",
    tabHover: "#5a6b70",
    tabMuted: "#6b7280",
    tabInactiveHover: "rgba(76, 90, 95, 0.5)",
    alert: "#383838",
    inputIsland: "#ffffff",
    inputIslandHover: "#f0f0f0",
  },
  text: {
    primary: "#ffffff",
    onDark: "#fff",
    secondary: "#a7a9b6",
    muted: "#6b7280",
    navIcon: "#c2c9d6",
    onLight: "#000000",
    orderBookMuted: "#666666",
    footerStrong: "rgba(255, 255, 255, 0.8)",
    footerSubtle: "rgba(255, 255, 255, 0.5)",
    onDarkMuted: "rgba(255, 255, 255, 0.7)",
    tableRgb: "rgb(194, 194, 194)",
    buttonDisabled: "#cccccc",
    walletMuted: "rgb(155, 155, 155)",
    messageLink: "#289ec1",
  },
  chart: {
    grid: "#333333",
    axisMuted: "#888888",
    tooltipBg: "#1a1a1a",
    tooltipBorder: "#333333",
    seriesBtc: "#f7931a",
  },
  trading: {
    long: "#22c55e",
    longHover: "#16a34a",
    short: "#ef4444",
    shortHover: "#dc2626",
    warning: "#f59e0b",
    highlight: "#fbbf24",
    info: "#3b82f6",
    longRowBg: "rgba(34, 197, 94, 0.2)",
    shortRowBg: "rgba(239, 68, 68, 0.2)",
    infoRowBg: "rgba(59, 130, 246, 0.2)",
    longRowBgAlt: "rgba(34, 197, 94, 0.25)",
    shortRowBgAlt: "rgba(239, 68, 68, 0.25)",
    longHighlightBg: "rgba(34, 197, 94, 0.3)",
    shortHighlightBg: "rgba(239, 68, 68, 0.3)",
    longHighlightGlow: "rgba(34, 197, 94, 0.4)",
    shortHighlightGlow: "rgba(239, 68, 68, 0.4)",
    infoHighlightBg: "rgba(59, 130, 246, 0.3)",
    infoHighlightGlow: "rgba(59, 130, 246, 0.5)",
    infoBorder: "rgba(59, 130, 246, 0.6)",
    neutralRowBg: "rgba(107, 114, 128, 0.2)",
    statusClosed: "#6b7280",
  },
  accent: {
    main: "#509EBA",
    mainLower: "#509eba",
  },
  border: {
    default: "rgba(171, 171, 171, 1)",
    muted02: "rgba(171, 171, 171, 0.2)",
    muted03: "rgba(171, 171, 171, 0.3)",
    muted04: "rgba(171, 171, 171, 0.4)",
    muted05: "rgba(171, 171, 171, 0.5)",
    muted06: "rgba(171, 171, 171, 0.6)",
  },
  overlay: {
    white02: "rgba(255, 255, 255, 0.02)",
    white03: "rgba(255, 255, 255, 0.03)",
    white05: "rgba(255, 255, 255, 0.05)",
    white08: "rgba(255, 255, 255, 0.08)",
    white10: "rgba(255, 255, 255, 0.1)",
    white14: "rgba(255, 255, 255, 0.14)",
    white15: "rgba(255, 255, 255, 0.15)",
    white16: "rgba(255, 255, 255, 0.16)",
    white18: "rgba(255, 255, 255, 0.18)",
    white20: "rgba(255, 255, 255, 0.2)",
    white30: "rgba(255, 255, 255, 0.3)",
    white40: "rgba(255, 255, 255, 0.4)",
    white50: "rgba(255, 255, 255, 0.5)",
    black30: "rgba(0, 0, 0, 0.3)",
    black50: "rgba(0, 0, 0, 0.5)",
    black90: "rgba(0, 0, 0, 0.9)",
  },
  card: {
    tint: "rgba(79, 126, 145, 0.04)",
    tint08: "rgba(79, 126, 145, 0.08)",
    radialGradient:
      "radial-gradient(circle, rgba(0, 0, 0, 0) 36%, rgba(255, 255, 255, 0.05) 100%)",
    dividerLight: "#eaf7fc",
  },
  modal: {
    backdrop: "rgba(0, 0, 0, 0.9)",
    radialGradient:
      "black radial-gradient(circle, rgba(0, 0, 0, 0.1) 36%, rgba(255, 255, 255, 0.1) 100%)",
  },
  mui: {
    autofillBg: "#0e1c26",
  },
  landing: {
    gradientStop: "rgb(41, 50, 54)",
    cardShadow: "rgba(0, 0, 0, 0.2)",
    buttonOverlay:
      "linear-gradient(45deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0) 100%)",
  },
  actionButton: {
    bg: "#e2edfb",
    text: "#064152",
    iconMuted: "rgb(111, 111, 111)",
  },
  circularProgress: {
    default: "rgb(80, 158, 186)",
    error: "rgb(255, 59, 59)",
    success: "rgb(71, 158, 71)",
    track: "rgba(50, 50, 50)",
  },
  marketplaceChart: {
    success: "rgb(80, 158, 186)",
    neutral: "rgb(42, 42, 42)",
  },
  error: {
    link: "#2563eb",
    iconDanger: "#ff3b3b",
  },
  scrollbar: {
    thumb: "#888888",
    track: "#222222",
    hover: "#444444",
  },
  multistep: {
    errorOverlay: "rgba(106, 0, 0, 0.44)",
  },
  purchasedContracts: {
    lineGradient:
      "linear-gradient(0deg, rgba(128, 125, 125, 1) 12%, rgba(26, 26, 26, 1) 100%)",
  },
  spinner: {
    accent: "#53b1bd",
  },
  closePositionModal: {
    textMuted: "#d1d5db",
    textSubtle: "#9ca3af",
  },
  perps: {
    highlightBorder: "rgba(251, 191, 36, 0.15)",
    highlightBorderStrong: "rgba(251, 191, 36, 0.45)",
    highlightBg: "rgba(251, 191, 36, 0.1)",
    highlightBorderSoft: "rgba(251, 191, 36, 0.3)",
    yellowRadial:
      "radial-gradient(circle, rgba(0, 0, 0, 0) 36%, rgba(255, 255, 0, 0.05) 100%)",
  },
  formButtons: {
    secondaryBg: "rgb(84, 90, 92)",
    secondaryText: "rgb(163, 163, 163)",
  },
  nav: {
    divider: "#f4f4f4",
  },
  slider: {
    thumbMuted: "rgba(107, 114, 128, 0.5)",
  },
} as const;

export type FuturesDarkTokens = typeof futuresDark;

/** Flat kebab-case map merged into Tailwind `theme.extend.colors`. */
export const futuresDarkTailwind: Record<string, string> = {
  "futures-app-bg": futuresDark.app.bg,
  "futures-surface-panel": futuresDark.surface.panel,
  "futures-surface-footer": futuresDark.surface.footer,
  "futures-surface-mobile-tab": futuresDark.surface.mobileTabBg,
  "futures-surface-tab-active": futuresDark.surface.tabActive,
  "futures-surface-tab-hover": futuresDark.surface.tabHover,
  "futures-surface-tab-muted": futuresDark.surface.tabMuted,
  "futures-surface-alert": futuresDark.surface.alert,
  "futures-text-primary": futuresDark.text.primary,
  "futures-text-secondary": futuresDark.text.secondary,
  "futures-text-muted": futuresDark.text.muted,
  "futures-text-nav-icon": futuresDark.text.navIcon,
  "futures-accent": futuresDark.accent.main,
  "futures-trading-long": futuresDark.trading.long,
  "futures-trading-long-hover": futuresDark.trading.longHover,
  "futures-trading-short": futuresDark.trading.short,
  "futures-trading-short-hover": futuresDark.trading.shortHover,
  "futures-trading-warning": futuresDark.trading.warning,
  "futures-trading-highlight": futuresDark.trading.highlight,
  "futures-trading-info": futuresDark.trading.info,
  "futures-chart-grid": futuresDark.chart.grid,
  "futures-chart-btc": futuresDark.chart.seriesBtc,
};
