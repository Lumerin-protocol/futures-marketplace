# HashPowerFutures.sol — Value Placement Review

All values in `HashPowerFutures.sol` categorized by storage mechanism and update path.

---

## 1. Bytecode Constants (`constant` keyword)

Set at compile time. Change = new implementation deploy + proxy upgrade.

| Name | Value | Should it stay constant? | Notes |
|------|-------|--------------------------|-------|
| `VERSION` | `"3.8.0"` | ✅ Yes | Informational, tied to bytecode |
| `CONTRACT_SIZE_HPS_DAY` | `1e15` | ✅ Yes | Fundamental economic unit. Changing it breaks every existing position's notional calculation |
| `SECONDS_PER_DAY` | `86400` | ✅ Yes | Mathematical constant |
| `MAX_ORACLE_STALENESS` | `3600` | ⚠️ Debatable | Safety parameter. Fine as constant — changing it is a protocol-level decision, not an operational tweak |

### 🔴 Should move from `constant` → proxy storage with setter

| Name | Current Value | Why move |
|------|---------------|----------|
| `MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION` | `100` | Per-delivery UX/gas limit. Raising it doesn't break positions. Should be adjustable without redeploy. |
| `MAX_PRICE_LEVELS_PER_SIDE` | `200` | Order book density limit. Same reasoning — operational knob, not fundamental. |

### 🟡 Requires position wipe if changed

| Name | Current Value | Why |
|------|---------------|-----|
| `EXPIRATION_INTERVAL_DAYS` | `30` | Shifts the entire expiration calendar (`getExpirationDates()`, `validateExpirationAt()`). Existing positions at old expiration dates would become invalid for new orders. Keep as constant to signal: "don't touch without migration." |

---

## 2. Immutable (constructor)

| Name | Source | Notes |
|------|--------|-------|
| `_decimals` | Constructor arg (`uint8`) | Token invariant. Correct as immutable. |

`collateralVault` was previously immutable but moved to proxy storage to match the Perps pattern — set in `initialize`, fixable without redeploy.

---

## 3. Proxy Storage — Set Once in `initialize`, No Setter

Cannot change without a reinitializer or migration. Indexer reads once at bootstrap.

| Name | Why no setter? | Should it have one? |
|------|---------------|---------------------|
| `minimumPriceIncrement` | Tick size. Changing it mid-flight invalidates ALL resting orders. | ❌ No — **now a `constant = 1e4`** ($0.01). Removed from `initialize` params. |
| `firstFutureExpirationDate` | Anchors the expiration calendar. Changing it shifts all `getExpirationDates()` calculations, making existing positions' `expirationAt` values misaligned with the new window | ❌ No — **breaks positions, requires wipe** |

### No changes needed

Both `minimumPriceIncrement` and `firstFutureExpirationDate` are correctly placed. The former is now a hardcoded `constant`; the latter is init-only proxy storage because it's chain/deployment-specific.

---

## 4. Proxy Storage — Mutable via Owner Transaction

Indexer picks up via individual events. Safe to change anytime — no position impact.

| Name | Setter | Event | Safe to change live? |
|------|--------|-------|---------------------|
| `takerFee` | `setTakerFee` | `TakerFeeUpdated` | ✅ Yes — only affects new matches |
| `makerFee` | `setMakerFee` | `MakerFeeUpdated` | ✅ Yes — only affects new matches |
| `liquidationFee` | `setLiquidationFee` | `LiquidationFeeUpdated` | ✅ Yes — flat fee, only affects new liquidations |
| `liquidationFeeBps` | `setLiquidationFeeBps` | `LiquidationFeeBpsUpdated` | ✅ Yes — percentage fee, only affects new liquidations |
| `liquidatorShareBps` | `setLiquidatorShareBps` | `LiquidatorShareBpsUpdated` | ✅ Yes — split ratio, only affects new liquidations |
| `hook` | `setHook` | `HookUpdated` | ✅ Yes — points hook, additive feature |
| `marginEngine` | `setMarginEngine` | `MarginEngineUpdated` | ✅ Yes — PME address, only affects new margin checks |

### ⚠️ Operationally powerful — use with care

These affect existing positions' risk status instantly:

| Name | Setter | Event | Risk |
|------|--------|-------|------|
| `liquidationMarginPercent` | `setLiquidationMarginPercent` | `LiquidationMarginPercentUpdated` | Raising it can make healthy positions instantly liquidatable. Lowering it makes liquidatable positions healthy. **This is intentional** — it's the protocol's risk-adjustment knob during volatility. |
| `futureExpirationDatesCount` | `setFutureExpirationDatesCount` | `FutureExpirationDatesCountUpdated` | Changing it shifts which expirations accept new orders. Existing positions at "now-out-of-range" expirations still settle normally. Low risk. |

---

## 5. Proxy Storage — Implicitly Updated (Not Directly Settable)

| Name | How it's updated | Notes |
|------|-----------------|-------|
| `hashrateOracle` | `setOracle` → `_setHashrateOracle` | Also triggers `hashpriceScalingDivisor` recalculation |
| `hashpriceScalingDivisor` | Recalculated inside `_setHashrateOracle` | `10^(oracle.decimals() - token.decimals())`. Should be private — it's a derived cache, not an independent config value |

---

## 6. Internal / Operational State (No Review Needed)

These are trading state, not configuration:

| Name | Notes |
|------|-------|
| `nonce` | Order ID counter. Reset on migration. |
| `collectedFeesBalance` | Fee accumulator. Withdrawn by owner. |
| `participantExpirationAtNetDelta` / `participantExpirationAtNetEntryValue` | Position state |
| `activeBidPrices` / `activeAskPrices` | Order book ladders |
| `settlementPrice` | Per-expiration settlement pin |
| `participantActiveExpirationAts` | User position index |

---

## Summary Table

| Value | Current Location | Recommended Location | Reason |
|-------|-----------------|---------------------|--------|
| `VERSION` | `constant` | `constant` ✅ | Bytecode identity |
| `CONTRACT_SIZE_HPS_DAY` | `constant` | `constant` ✅ | Fundamental unit |
| `SECONDS_PER_DAY` | `constant` | `constant` ✅ | Math |
| `MAX_ORACLE_STALENESS` | `constant` | `constant` ✅ | Protocol safety |
| **`MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION`** | `constant` | ➡️ **proxy + setter** | Operational knob |
| **`MAX_PRICE_LEVELS_PER_SIDE`** | `constant` | ➡️ **proxy + setter** | Operational knob |
| `EXPIRATION_INTERVAL_DAYS` | `constant` | `constant` ✅ | Breaks calendar if changed |
| `collateralVault` | proxy (init) | proxy (init) ✅ | Matches Perps pattern. Set in `initialize`, no setter. |
| `_decimals` | `immutable` | `immutable` ✅ | Token invariant |
| **`minimumPriceIncrement`** | proxy (init only) | ➡️ **`constant = 1e4`** ✅ Done | $0.01 in USDC, never changes |
| `firstFutureExpirationDate` | proxy (init only) | proxy (init only) ✅ | Breaks calendar if changed |
| `takerFee` | proxy + setter | proxy + setter ✅ | Live-adjustable |
| `makerFee` | proxy + setter | proxy + setter ✅ | Live-adjustable |
| `liquidationFee` | proxy + setter | proxy + setter ✅ | Live-adjustable |
| `liquidationFeeBps` | proxy + setter | proxy + setter ✅ | Live-adjustable |
| `liquidatorShareBps` | proxy + setter | proxy + setter ✅ | Live-adjustable |
| `liquidationMarginPercent` | proxy + setter | proxy + setter ✅ | Risk management |
| `futureExpirationDatesCount` | proxy + setter | proxy + setter ✅ | Low risk |
| `hashrateOracle` | proxy + setter | proxy + setter ✅ | Live-adjustable |
| `marginEngine` | proxy + setter | proxy + setter ✅ | Live-adjustable |
| `hook` | proxy + setter | proxy + setter ✅ | Live-adjustable |
| `hashpriceScalingDivisor` | proxy (derived) | Make `private` | Not a config value |

---

## Impact of Changing Each Value

| Change | Effect | Mitigation |
|--------|--------|------------|
| `CONTRACT_SIZE_HPS_DAY` | Every position's PnL is wrong | **Requires wipe + migration** |
| `EXPIRATION_INTERVAL_DAYS` | `getExpirationDates()` shifts. Orders at old expirations can't be placed. | **Requires wipe** or careful migration |
| `firstFutureExpirationDate` | Same as above | **Requires wipe** |
| `minimumPriceIncrement` | All resting orders fail `validatePrice()` | **Requires full order cancellation** |
| `MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION` | No existing position impact. The cap applies independently to each delivery index. | None needed |
| `MAX_PRICE_LEVELS_PER_SIDE` | No existing state impact. New levels rejected at cap; existing levels untouched. | None needed |
| `liquidationMarginPercent` | Instant re-evaluation of all positions against new MM | Keeper monitors; liquidates where needed |
| All fee params | Only new matches/liquidations affected | None needed |
| `hashrateOracle` | Price source changes. New `hashpriceScalingDivisor` if oracle decimals differ. | Verify new oracle decimals match or scaling is correct |
| `_decimals` | Everything (prices, notional, PnL) scaled wrong | **Catastrophic — never change** |
