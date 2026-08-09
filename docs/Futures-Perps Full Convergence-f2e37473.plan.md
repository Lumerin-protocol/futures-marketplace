<!-- f2e37473-7101-45c0-9745-73e846800e6d -->
---
todos:
  - id: "safety-correctness"
    content: "Land isolated Perps oracle, liquidation, PnL, flat-position, and order-removal correctness commits"
    status: pending
  - id: "perps-convergence"
    content: "Implement Perps validation, policy, exact-entry migration, reset, and ABI convergence commits"
    status: pending
  - id: "futures-convergence"
    content: "Implement Futures API parity, user-index migration, reset, hook, oracle, and ABI convergence commits"
    status: pending
  - id: "consumer-cutover"
    content: "Update indexers, keeper, market maker, and UI for breaking ABI/position semantics"
    status: pending
  - id: "final-rename"
    content: "Rename the complete Futures contract/tooling hierarchy to HashPowerFutures as the last change"
    status: pending
isProject: false
---
# Futures and Perps Full Convergence

## Fixed decisions
- Scope includes Perps exact signed `netEntryValue` migration and Futures global user enumeration/backfill.
- PnL shortfalls pay available funds, emit `BadDebt` for every unpaid amount, and create no claim ledger.
- Both venues require six-decimal collateral, scale supported oracle precisions in either direction, keep the `$0.01` tick at `10_000`, and reject non-positive/uninitialized/future/stale rounds.
- Portfolio IM is canonical; Perps `minimumMarginPerOrder` storage/API remains compatibility-only but stops rejecting orders.
- Minimize selector churn by using the existing Futures error vocabulary as canonical and migrating Perps callers.
- Preserve old reset entry points as wrappers; add explicit participant and global reset names.

## Commit and verification protocol
- First preserve the two audit documents and this plan in a docs-only commit.
- Before storage edits, capture and test append-only storage-layout baselines for [HashPowerPerpsDEXBase.sol](/Users/shev/Dev/titan/perps/contracts/contracts/HashPowerPerpsDEXBase.sol) and [FuturesBase.sol](/Users/shev/Dev/titan/futures-marketplace/contracts/contracts/FuturesBase.sol).
- Each numbered item below is one logical fix and one commit in each affected repository; never mix adjacent findings. Cross-repository fixes use dependency-ordered commits because one Git commit cannot span repositories.
- Before every contract commit run `pnpm compile`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` from that repository’s `contracts` directory. Also run the storage-layout check and deployed-size check for storage/ABI work, `pnpm test:gas` for Futures hot-path work, and `pnpm aderyn` for high-risk Perps accounting work.
- Before every indexer/UI/keeper/market-maker commit run that package’s lint, typecheck, full tests, and build where available. Commit only after all required checks pass; report and fix regressions before proceeding.

## Ordered implementation
1. **Perps oracle correctness.** In [HashPowerPerpsDEXBase.sol](/Users/shev/Dev/titan/perps/contracts/contracts/HashPowerPerpsDEXBase.sol), reject zero and invalid rounds, validate six-decimal collateral at initialization, permit bidirectional oracle scaling, expose `MAX_ORACLE_STALENESS`, and add boundary tests.
2. **Perps orders-aware liquidation status.** Update `isLiquidatable` in [HashPowerPerpsDEX.sol](/Users/shev/Dev/titan/perps/contracts/contracts/HashPowerPerpsDEX.sol) to require a position or resting-order delta before the PME MM test; cover order-only accounts.
3. **Perps partial-liquidation points.** Notify the points hook on partial position liquidation and test one notification per successful path.
4. **Perps PnL liveness.** Centralize realized PnL transfer in [HashPowerPerpsDEXBase.sol](/Users/shev/Dev/titan/perps/contracts/contracts/HashPowerPerpsDEXBase.sol); use the Futures clamped-transfer policy for voluntary reduction, partial liquidation, and full liquidation, and test both user-loss and insurance-profit shortfalls.
5. **Perps flat-position cleanup.** Clear the legacy average entry price on an exact close and lock event/getter post-state with tests.
6. **Perps atomic order removal.** Add one full-removal helper and one partial-reduction helper, then route cancellation, fills, STP, liquidation, and reset through them. Add invariants for queues, price levels, user indexes, order aggregates, and storage.
7. **Perps initializer and PME validation.** Keep historical initializer signatures, validate supplied vaults against the immutable vault, route PME assignment through one validator, and probe `vault`, `linearOrderMargin(0)`, `imSpotShock`, and `mmSpotShock`.
8. **Perps minimum-order-margin deprecation.** Remove enforcement from create/reduce paths while retaining the slot, getter, setter, event, and legacy error declaration for compatibility; update admin/docs/tests.
9. **Perps exact entry-value storage migration.** Append `participantNetEntryValue` plus a materialization marker at the storage tail without changing the legacy `Position` layout. Canonical values are signed collateral units (`quantity × price / 1e6`); lazily materialize before mutation, keep `aggregatedEntryPrice` synchronized for rollback compatibility, make `getUserPosition` return `(netQuantity, netEntryValue)`, add a derived average-price getter, and supply an idempotent owner batch migration/script over `getUsersWithPositions`. Test pre/post PnL, funding, exact closes, shorts, partial reductions, rollback shadow state, and repeated migration.
10. **Perps explicit reset APIs.** Add participant-scoped and global reset methods in [HashPowerPerpsDEXAdmin.sol](/Users/shev/Dev/titan/perps/contracts/contracts/HashPowerPerpsDEXAdmin.sol), retain `resetState()` as the global wrapper, keep nonce monotonic, clear migrated position state correctly, and stop emitting legacy `MatchFeeUpdated` while retaining its declaration.
11. **Perps ABI naming convergence.** Normalize return names, rename the `PositionLiquidated` field to `closedQuantity` without changing its topic, add `QUANTITY_DECIMALS = 6`, adopt canonical shared errors, bump the breaking major version, regenerate ABIs, and update [perps indexer](/Users/shev/Dev/titan/perps/indexer) decoding/tests in its own commit.
12. **Futures cheap API parity.** Add `balanceOf(address)` and `QUANTITY_DECIMALS = 0`, normalize ABI return names, regenerate ABIs, and test metadata plus vault forwarding.
13. **Futures user enumeration and migration.** Append user sets/counters and migration-completion state at the tail of [FuturesBase.sol](/Users/shev/Dev/titan/futures-marketplace/contracts/contracts/FuturesBase.sol); maintain them on every position/order transition, expose `getUsersWithPositions`, and add idempotent owner sync/finalize methods. Add [scripts](/Users/shev/Dev/titan/futures-marketplace/contracts/scripts) that discover historical participants, sync gas-bounded batches, verify current state, and only then finalize.
14. **Futures explicit reset APIs.** Add participant and global reset names in [FuturesAdmin.sol](/Users/shev/Dev/titan/futures-marketplace/contracts/contracts/FuturesAdmin.sol), preserve `resetState(address[])` as a participant wrapper, and block global reset until enumeration migration is finalized.
15. **Futures points snapshot.** Snapshot the hook and reference price once per taker matching walk in [FuturesBase.sol](/Users/shev/Dev/titan/futures-marketplace/contracts/contracts/FuturesBase.sol), pass them through fills, and prove the multi-level gas change with `pnpm test:gas` before committing.
16. **Futures dependency/oracle policy.** Use the same four PME capability probes, enforce the selected six-decimal collateral/oracle policy, reject all invalid rounds consistently, and add initialization/admin/runtime tests.
17. **Futures error and ABI convergence.** Normalize remaining shared error usage and return names, bump the major contract version, regenerate ABI/error files, and adapt its indexer consumers in a separate dependency-ordered commit.
18. **Downstream exact-position cutover.** Update [collateral-margin keeper](/Users/shev/Dev/titan/collateral-margin/keeper), market maker, [Futures UI](/Users/shev/Dev/titan/futures-marketplace/ui), and any Perps consumers to treat `netEntryValue` as signed collateral value and derive average entry only for display. Remove active use of the deprecated minimum-order-margin policy and pin regenerated ABIs.
19. **Final rename wave: `Futures` → `HashPowerFutures`.** After all functional commits, rename the complete Solidity hierarchy, artifacts, ABI symbols/files, migration harnesses, fixtures, deployment/update/reset scripts, gas benchmark IDs, indexer data-source types, workflows, and downstream imports from `Futures*` to `HashPowerFutures*`. Keep the repository/package/domain term “futures” where it names the product, preserve the existing proxy address/storage/selectors/events, remove temporary artifact aliases before completion, and make no functional code changes after this coordinated rename series.

## Final release checks
- Compare storage layouts slot-by-slot and verify both implementations remain under EIP-170 limits.
- Run all contract, indexer, UI, keeper, and market-maker suites from their package scripts.
- Exercise both upgrade scripts against a fork/state snapshot: verify Perps quantity/entry/PnL/funding before and after migration, and verify Futures participant discovery/backfill/finalization before enabling global reset.
- Confirm generated ABIs, deployment manifests, Base Sepolia verification FQNs, indexer templates, and consumer pins contain `HashPowerFutures` and the new Perps position semantics with no stale `Futures` artifact imports.
