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
}

export namespace PositionSessionStatus {
  export const OPEN: string = "OPEN";
  export const CLOSE: string = "CLOSE";
}
