<!-- f2e37473-7101-45c0-9745-73e846800e6d -->
---
todos:
  - id: "safety"
    content: "Fix and test margin-safety prerequisites: reduce-only bypass, stale PME oracle, and signed option gamma"
    status: pending
  - id: "venue-hotpaths"
    content: "Optimize Perps aggregate lookups and retire redundant Futures write indexes"
    status: pending
  - id: "batch-book"
    content: "Add ladder fast paths and remove inert batch/liquidation work"
    status: pending
  - id: "risk-fanout"
    content: "Optimize inactive risk views, bitmap checks, and repeated external calls"
    status: pending
  - id: "pme-options"
    content: "Collapse PME/options fan-out and evaluate benchmark-gated snapshot APIs"
    status: pending
isProject: false
---
# Futures, Perps, and PME critical-path optimizations

## Correctness prerequisites
- Remove the venue-local “reduce-only” IM bypass in [perps/contracts/contracts/HashPowerPerpsDEX.sol](perps/contracts/contracts/HashPowerPerpsDEX.sol) and [futures-marketplace/contracts/contracts/Futures.sol](futures-marketplace/contracts/contracts/Futures.sol). A locally reducing order can increase cross-product exposure; only cancel/reduce-only batches with no creates can safely skip PME.
- Make the PME oracle fail closed instead of returning zero stress when stale in [collateral-margin/contracts/contracts/PortfolioMarginEngine.sol](collateral-margin/contracts/contracts/PortfolioMarginEngine.sol).
- Represent option gamma with its sign before algebraically simplifying stress scenarios; current short gamma is reported as positive by [perps/contracts/contracts/OptionMarginEngine.sol](perps/contracts/contracts/OptionMarginEngine.sol).

## Ranked optimizations
1. **Perps aggregate reduce-only lookup — highest ROI, low risk.** Replace the up-to-100-order scan in `_restingReduceAbs` with `userOrderAggregate.buyQty/sellQty`; omit classification entirely in batch callers that discard it. Expected saving: tens of thousands normally and roughly 0.4–0.85M gas near the cap.
2. **Retire redundant Futures write indexes — high ROI, low/medium risk.** Stop maintaining the unread `participantExpirationAtPriceOrderIdsIndex` while retaining its storage slot. Then migrate `resetState` away from `participantOrderExpirationAts` so that redundant set can stop receiving writes. Expected saving: about 45–65k per resting order, plus another 45–65k on the first order per user/expiry.
3. **Add price-ladder fast paths — high variable ROI.** In both `PriceLadderLib` copies, skip insertion work for existing levels and add validated head/tail insertion paths. Expected saving: several thousand on existing/boundary levels and about 4.2k per linked-list node no longer traversed. Defer caller hints or bitmap migration until benchmarks justify the API/storage complexity.
4. **Reduce unnecessary risk/oracle work — low risk.** Make Perps `getRiskView` return immediately for users with no Perps state and reuse its price for pending funding. Directly mask Futures bitmap words for `hasRestingOrderDelta`. Expected saving: roughly 2–10k per avoided oracle read plus several thousand per bitmap check; this also prevents an irrelevant Perps feed from blocking Futures-only users.
5. **Skip work on inert batch operations — low risk.** Skip final IM for `updateOrders` with no creates and return early for empty batches. Validate stale liquidation IDs/zero position legs before each expensive MM recomputation. Expected saving: one full PME traversal—often 20–100k+—per inert operation or stale candidate.
6. **Remove repeated external calls in fills — very low/medium risk.** Short-circuit Perps zero fees and zero liquidation shares, cache insurance addresses within settlement branches, settle the Perps batch taker once, and cache the points reference price across multi-maker fills. Expected saving: several thousand per avoided vault/oracle call and more on sweeps.
7. **Collapse PME/options fan-out — medium risk.** Add one options portfolio view returning Greeks plus reserved margin, load each option series once, consume `computePortfolioMargins` in overview/keeper paths, and fast-return `orderMarginOf` when no market has orders. Expected saving: 30–100k+ per account and substantially more with many active option series.
8. **Benchmark-gated changes.** Consider a combined PME liquidation snapshot (MM plus resting-order flag), then algebraically collapse stress endpoints after signed gamma is fixed. Defer registered-market supplied risk snapshots unless measurements show at least ~8–10k savings; they add cross-repository ABI and stale-state complexity for likely modest benefit.

## Verification and delivery
- Add focused Perps and PME gas cases before changing behavior; preserve the existing Futures snapshot in [futures-marketplace/contracts/benchmarks/futures-gas.json](futures-marketplace/contracts/benchmarks/futures-gas.json).
- Implement one optimization per commit, running each repository’s compile, full tests, typecheck, lint, contract-size check, and relevant gas benchmark after every commit.
- For cross-repository ABI changes, land PME/interfaces first, update dependency pins, then land Futures and Perps consumers.