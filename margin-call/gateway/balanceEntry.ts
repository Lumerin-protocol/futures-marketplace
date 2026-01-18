export type BalanceEntry = {
  address: `0x${string}`;
  minMargin: bigint;
  balance: bigint;
  marginUtilizationRatio: number;
};
