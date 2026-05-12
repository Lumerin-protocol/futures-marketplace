export type BalanceEntry = {
  address: `0x${string}`;
  /// Initial Margin requirement (token decimals) — drives the alert / utilization metric.
  initialMargin: bigint;
  /// Maintenance Margin requirement (token decimals) — drives the on-chain `marginCall` trigger.
  maintenanceMargin: bigint;
  /// Vault balance (token decimals).
  balance: bigint;
  /// `initialMargin / balance`. Reported to the notifications service.
  marginUtilizationRatio: number;
};
