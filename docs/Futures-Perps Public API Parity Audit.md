# Futures–Perps Public API Parity Audit

Audited Futures `4.4.0` and Perps `2.15.0`.

## Ranked avoidable drift

| Rank | Mismatch | Recommended direction | Impact | Complexity |
|---:|---|---|---|---|
| 1 | `isLiquidatable` includes orders in Futures but requires a position in Perps, even though Perps supports order-only liquidation. | Use `hasPositionOrOrders && belowPortfolioMM` in both. | Keeper/UI correctness; no ABI change. | Low |
| 2 | PnL shortfalls differ: Futures clamps and emits `BadDebt`; Perps partial settlement reverts, while full liquidation can silently omit profit. | Use one clamped PnL-transfer policy and emit every unpaid amount. | Error/event behavior. | Medium |
| 3 | Public `Position` is `(netQuantity, netEntryValue)` in Futures and `(netQuantity, aggregatedEntryPrice)` in Perps. | Eventually standardize on exact `netEntryValue`; derive average entry. | Breaking Perps ABI/storage migration. | High |
| 4 | `resetState(address[])` is participant-scoped in Futures; `resetState()` is global in Perps. | Add explicit `resetParticipantState` and `resetAllState`, retaining old wrappers. | Additive ABI; safer admin tooling. | Medium |
| 5 | Common errors differ: `InvalidQty`/`InvalidSize`, `InsufficientMarginBalance`/`InsufficientMargin`, `ValueOutOfRange`/`InvalidMarginPercent`. Perps also uses `InsufficientCollateral` for a zero vault. | Adopt common error vocabulary in a coordinated ABI change. | Error selectors and client decoding. | Low |
| 6 | Quantity scale is implicit for Futures and explicit as six decimals for Perps. | Expose `QUANTITY_DECIMALS` in both; Futures should return `0`. | Additive ABI; UI/indexer clarity. | Low |
| 7 | Perps partial position liquidation omits `_notifyLiquidation`; the event field is `positionSize` versus Futures’ `closedQuantity`. | Notify on every path and rename the Perps ABI field to `closedQuantity`. | Rewards correctness; event topic unchanged. | Low |
| 8 | Perps alone exposes `balanceOf` and `getUsersWithPositions`. | Add the cheap `balanceOf` façade to Futures; treat global user enumeration as an optional extension. | Additive ABI; enumeration needs storage. | Low / High |
| 9 | Return names differ (`bids`/`asks`, unnamed quantities and aggregates), and `MAX_ORACLE_STALENESS` is public only in Futures. | Normalize ABI return names and expose the staleness getter in Perps. | Mostly generated bindings; selectors unchanged. | Low |
| 10 | Futures rejects a runtime oracle answer `<= 0`; Perps rejects only `< 0`. Decimal-support policy also differs. | Share one oracle policy and reject non-positive answers. | Runtime correctness; no storage change. | Low |
| 11 | Perps alone enforces `minimumMarginPerOrder`. | Document it as a Perps fractional-quantity extension, or adopt it consistently later. | Behavioral policy. | Medium |
| 12 | Legacy Perps `MatchFeeUpdated` is still emitted by reset despite canonical individual fee events. | Stop emitting it; retain the declaration for historical consumers. | Indexer behavior only. | Low |

## Intentional differences

- Futures needs `expirationAt`, per-expiry books/indexes, settlement prices, expiry cleanup, and expiry-batch liquidation.
- Perps needs funding state and funding update/settlement APIs.
- Futures quantities are whole contracts; Perps quantities are fractional.
- Historical migration methods and dead storage slots follow each deployment’s upgrade history.
- Futures’ vestigial liquidation-margin getter/setter should remain compatibility-only, not be copied to Perps.

## Already aligned

- `OrderAggregate`, `ReduceIntent`, and `TimeInForce`.
- `createOrder(s)`, `updateOrders`, `reduceOrderSize`, and `cancelOrder`.
- Single and batch order liquidation.
- Risk, order-book, market-price, aggregate, PnL, and simulation getter families.
- Fee, oracle, portfolio-margin, hook, and revenue-withdrawal admin methods.
- Core order lifecycle and configuration events where expiry is not applicable.
