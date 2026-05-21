// Mirrors GraphQL schema enums. Subgraph mappings store enum values as strings,
// so we expose them as namespaced `const string` constants for type-safety
// and to avoid string-literal sprinkles throughout the handlers.

export namespace OrderStatus {
  export const ACTIVE: string = "ACTIVE";
  export const PARTIAL: string = "PARTIAL";
  export const FILLED: string = "FILLED";
  export const CANCELLED: string = "CANCELLED";
}

export namespace OrderEntryStatus {
  export const ACTIVE: string = "ACTIVE";
  export const MATCHED: string = "MATCHED";
  export const CANCELLED: string = "CANCELLED";
  export const EXPIRED: string = "EXPIRED";
  export const LIQUIDATED: string = "LIQUIDATED";
  export const RESET: string = "RESET";
}

export namespace PositionSessionStatus {
  export const OPEN: string = "OPEN";
  export const CLOSE: string = "CLOSE";
}

export namespace LotStatus {
  export const OPEN: string = "OPEN";
  export const REPLACED: string = "REPLACED";
  export const CLOSED: string = "CLOSED";
}

export namespace LotCloseReason {
  export const MUTUAL_EXIT: string = "MUTUAL_EXIT";
  export const LIQUIDATION: string = "LIQUIDATION";
  export const BREACH: string = "BREACH";
  export const SETTLED: string = "SETTLED";
  export const RESET: string = "RESET";
}
