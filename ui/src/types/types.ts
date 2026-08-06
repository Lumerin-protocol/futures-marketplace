// Exported types here
// Types local to a file will be in that file

// Contract Mode for Perpetual vs Expiring Futures
export type ContractMode = "perpetual" | "futures";

// Shared type for account (wallet) payment token balance query result
export interface AccountBalance {
  data: bigint | undefined;
  isLoading: boolean;
}

export enum AddressLength {
  SHORT = 0,
  MEDIUM = 1,
  LONG = 2,
}

export enum PathName {
  Landing = "/",
  Futures = "/futures",
  Leaderboard = "/leaderboard",
}
