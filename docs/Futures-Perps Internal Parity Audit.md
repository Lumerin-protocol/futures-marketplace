# Futures–Perps Internal Parity Audit

The core CLOB, margin, fee, and liquidation architecture is already substantially aligned. The highest-value convergence work is correctness-related rather than cosmetic.

## Ranked findings

### 1. Unify Perps PnL shortfall behavior

Perps voluntary/partial reductions revert when insurance cannot pay profit, while full liquidation can delete the position without paying the profit. Futures consistently transfers what is available and emits `BadDebt` for the shortfall.

Recommended direction: create one Perps `_transferPnl` primitive matching the Futures liveness-preserving policy. A claimable debt model would require new storage and should be a separate design.

Risk: high. Complexity: medium. No ABI/storage change for event-only clamping.

### 2. Reject zero runtime oracle prices in Perps

Perps `_marketPrice` rejects only `answer < 0`; Futures rejects `answer <= 0`. A feed that later returns zero can mark or liquidate Perps at zero and can break funding math.

Recommended direction: change Perps to reject non-positive answers and share one oracle read/scale policy.

Risk: high. Complexity: low. No ABI/storage change.

### 3. Make Perps `isLiquidatable` orders-aware

Perps reports false for orders-only accounts even though resting orders contribute to MM and `liquidateOrder(s)` supports those accounts. Futures checks orders or positions.

Recommended direction: `hasRestingOrderDelta(user) || positions[user].netQuantity != 0`, then `_underwater(user)`.

Risk: medium-high. Complexity: low. ABI unchanged.

### 4. Notify points on Perps partial liquidation

Full Perps liquidation and both Futures liquidation branches notify the hook. Perps partial liquidation only emits `PositionLiquidated`.

Recommended direction: call `_notifyLiquidation` immediately after the partial-liquidation event.

Risk: medium. Complexity: low. ABI/storage unchanged.

### 5. Clear Perps entry price on an exact close

An exact Perps offset zeros `netQuantity` but leaves `aggregatedEntryPrice`, so flat accounts and `OrderMatched` post-state can report stale entry data. Futures clears both fields.

Recommended direction: zero `aggregatedEntryPrice` when the resulting quantity is zero.

Risk: medium-low. Complexity: low. ABI/storage unchanged.

### 6. Resolve ignored Perps initializer parameters

The legacy `_vault` parameters in `initialize` and `initializeV2` are silently ignored. They can disagree with the immutable vault, and `initializeV2` can store an unvalidated PME.

Recommended direction: either remove dead arguments for new deployment APIs, as done in Futures, or retain historical signatures and validate `_vault == vault`. Route PME setup through the same validated setter logic.

Risk: medium operational. Complexity: low.

### 7. Standardize PME dependency validation

Futures probes `imSpotShock` and `mmSpotShock`; Perps probes `linearOrderMargin`. Both validate the vault.

Recommended direction: use a common capability probe covering `vault`, `linearOrderMargin(0)`, `imSpotShock`, and `mmSpotShock`.

Risk: medium-low. Complexity: low. ABI/storage unchanged.

### 8. Define one oracle decimal policy

Futures rejects collateral precision above oracle precision, while Perps permits it and the shared math supports scaling both directions. Both hardcode a six-decimal `$0.01` tick.

Recommended direction: explicitly support six-decimal collateral only, or derive the tick from `collateralDecimals`. Remove one-sided checks that do not express the full policy.

Risk: medium for future collateral types. Complexity: low-medium.

### 9. Make Perps resting-order removal atomic

Futures’ `_removeRestingOrder` handles queue, index, aggregate, and storage removal. Perps callers separately maintain aggregate, queue/index, price level, and storage across cancellation, fills, liquidation, self-cross, and reset.

Recommended direction: introduce one Perps `_removeRestingOrder` helper and one partial-reduction helper.

Risk: medium maintainability. Complexity: medium. ABI/storage unchanged.

### 10. Snapshot the Futures points hook/reference price once

Perps snapshots the hook and reference price once per taker order; Futures reloads them per fill.

Recommended direction: pass the hook and reference price through the Futures matching walk, mirroring Perps.

Risk: low. Complexity: low-medium. ABI/storage unchanged.

### 11. Eventually converge position entry accounting

Futures stores exact signed entry value. Perps repeatedly rounds a weighted average price.

Recommended direction: append exact `netEntryValue` storage in Perps and keep average entry as a derived compatibility field.

Risk: low-medium cumulative rounding drift. Complexity: high due migration.

### 12. Decide whether minimum order margin is shared policy

Perps can reject small GTC remainders and reductions; Futures relies on PME portfolio IM and order-count limits.

Recommended direction: either deprecate Perps enforcement while retaining its legacy slot/getter, or deliberately add the policy to both venues.

Risk: low-medium behavioral drift. Complexity: low.

### 13. Clarify reset APIs

Futures resets selected participants; Perps globally clears book, positions, and funding. Perps documentation says nonce resets while the code leaves it unchanged.

Recommended direction: add explicit `resetParticipants` and `resetAllTestnetTradingState` names and deprecate ambiguous wrappers.

Risk: medium operational. Complexity: low-medium.

## Cosmetic naming candidates

- `_ensureNoCollateralDeficit` versus `_ensureInitialMargin`.
- `InvalidQty` versus `InvalidSize`.
- `_increase/_decreaseOrderAggregate` versus `_add/_subtractOrderAggregate`.
- `_getMarketPrice(_getPrice())` versus `_marketPrice`.
- Public versus private `MAX_ORACLE_STALENESS`.

These should follow correctness fixes and can be grouped into a coordinated ABI naming pass where selectors change.

## Intentional product differences

- Futures expiration, delivery-window, settlement-price, and per-expiry state.
- Perps funding and one aggregate position per user.
- Product-specific quantity scaling and notional formulas.
- Historical migration functions and retained upgrade-safe slots.

## Strongly aligned areas

- Stateless admin layers and append-only Base storage.
- Immutable vaults, UUPS authorization, and implementation versions.
- GTC/IOC/FOK, batch create/update, FIFO reductions, sorted ladders, STP, and order IDs.
- Portfolio-wide IM checks and reduce-only exception.
- Orders-first liquidation and shared `ILinearMarket.RiskView`.
- Signed fees, fee bounds, same-match rebate funding, liquidation fee split, revenue withdrawal.
- Oracle smoke tests, PME-vault matching, and optional points hooks except the partial Perps omission.
