// function assessRisk(state: RiskState, config: Config): RiskLevel {
//   const absPosition = state.position < 0n ? -state.position : state.position;
//   const totalPnL = state.realizedPnL + state.unrealizedPnL;

//   // STOPPED: Breached hard limits - stop quoting entirely
//   if (totalPnL < -config.MAX_DAILY_LOSS) return "stopped";
//   if (absPosition >= config.MAX_POSITION) return "stopped";

//   // CRITICAL: Near limits - widen spreads significantly, reduce size
//   if (state.unrealizedPnL < -config.MAX_UNREALIZED_LOSS) return "critical";
//   if (absPosition >= config.POSITION_WARNING) return "critical";

//   // ELEVATED: Approaching limits - widen spreads slightly
//   if (absPosition >= config.POSITION_WARNING / 2n) return "elevated";

//   return "normal";
// }

function getSpreadMultiplier(riskLevel: RiskLevel): bigint {
  switch (riskLevel) {
    case "stopped":
      return 0n; // Don't quote
    case "critical":
      return 3n; // 3x wider spreads
    case "elevated":
      return 2n; // 2x wider spreads
    case "normal":
      return 1n; // Normal spreads
  }
}

function getSizeMultiplier(riskLevel: RiskLevel): number {
  switch (riskLevel) {
    case "stopped":
      return 0; // Don't quote
    case "critical":
      return 0.25; // 25% of normal size
    case "elevated":
      return 0.5; // 50% of normal size
    case "normal":
      return 1.0; // Normal size
  }
}

type RiskLevel = "stopped" | "critical" | "elevated" | "normal";

type RiskState = {
  realizedPnL: bigint; // Sum of closed trade profits/losses
  unrealizedPnL: bigint; // Current mark-to-market on open position
  position: bigint; // Current net position
  avgEntryPrice: bigint; // Average price of current position
  dailyStartingEquity: bigint; // Reset daily to track daily P&L
};
