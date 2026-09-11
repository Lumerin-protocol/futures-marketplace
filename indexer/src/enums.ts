// Mirrors GraphQL schema enums. Subgraph mappings store enum values as strings,
// so we expose them as namespaced `const string` constants for type-safety
// and to avoid string-literal sprinkles throughout the handlers.

export namespace OrderStatus {
  export const ACTIVE: string = "ACTIVE";
  export const PARTIALLY_FILLED: string = "PARTIALLY_FILLED";
  export const FILLED: string = "FILLED";
  export const CANCELLED: string = "CANCELLED";
  export const LIQUIDATED: string = "LIQUIDATED";
  export const EXPIRED: string = "EXPIRED";
}

export namespace FillSide {
  export const MAKER: string = "MAKER";
  export const TAKER: string = "TAKER";
}

export namespace PositionSessionStatus {
  export const OPEN: string = "OPEN";
  export const CLOSE: string = "CLOSE";
}
