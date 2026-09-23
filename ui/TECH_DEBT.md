# Tech debt — `ui`

Known issues that were deliberately deferred, and every lint suppression that is
still in the codebase. Added while bringing `pnpm typecheck` and
`pnpm exec biome lint src` to zero diagnostics.

Both commands are green as of this document. If either starts reporting again,
something below probably regressed.

Most entries here are things that are merely untidy. **§8 is the one that needs
somebody else: the UI derives position direction because the indexer does not
expose it, and one field upstream would delete the derivation.** **§9 is the one
that needs a decision before any work starts.**

---

## 1. Two copies of `@wagmi/core` in the tree (v2 and v3)

**Where:** `src/Web3Provider.tsx`

`@reown/appkit-adapter-wagmi@1.8.21` builds its config against `@wagmi/core@3.5.5`,
while the direct `wagmi@2.19.5` dependency brings `@wagmi/core@2.22.1`. The two
`Config` types are structurally incompatible, so the config object produced by
appkit cannot be handed to wagmi's `WagmiProvider` without a cast:

```tsx
<WagmiProvider config={config as unknown as Config}>
```

Runtime behaviour is unchanged — it is one object, and both packages read the same
fields. But the cast hides any real drift between the two majors.

**To resolve:** align the versions, most likely by upgrading the app to `wagmi@3`
so that only `@wagmi/core@3` remains, then delete the cast.

**Must be retested manually after any change here**, because none of it is covered
by types once the cast is in place:

- connecting and disconnecting a wallet through the appkit modal
- switching chains
- reconnect after a page reload
- a full order flow (approve + create order) to confirm signing still works

## 2. `ox` is pinned via an override to work around a broken upstream type

**Where:** `pnpm-workspace.yaml`

```yaml
overrides:
  viem@2.54.0>ox: 0.14.33
```

`viem@2.54.0` pins `ox` to exactly `0.14.29`, and that version ships a type error in
`ox/tempo/KeyAuthorization.ts`. Because it is a `.ts` source file rather than a
`.d.ts`, `skipLibCheck` does not cover it and `tsc --noEmit` fails on a file we do
not own. `0.14.33` fixes it.

The override is scoped to `viem@2.54.0` on purpose. An unscoped `ox: 0.14.33` also
collapses the older copies in the tree (`0.6.7`, `0.6.9`, `0.9.3`, `0.9.17`,
belonging to WalletConnect's `viem@2.23.2` among others) onto a version several
majors ahead of what they expect.

**To resolve:** drop the override once `viem` ships a release that pins a fixed `ox`.
Note that the pin includes the exact `viem` version, so a `viem` upgrade silently
deactivates the override — re-run `pnpm typecheck` after bumping `viem`.

## 3. Inconsistent `updatedAt` units in the chart data hooks

**Where:** `src/hooks/data/useHashRateIndexData.ts`,
`src/hooks/data/useBtcPriceIndexData.ts`, `src/components/Charts/HashrateChart.tsx`

The same field carries three different units depending on which branch produced it:

| Source | Value |
| --- | --- |
| `useHashRateIndexData.ts:106` (price `0`) | raw subgraph timestamp (microseconds), as a string |
| `useHashRateIndexData.ts:109` | milliseconds, as a number |
| `useHashRateIndexData.ts:166` | raw subgraph timestamp (microseconds), as a string |

`HashrateChart` has a fallback for rows without `updatedAtDate` that reads the field
as **seconds**:

```ts
const date = item.updatedAtDate || new Date(Number(item.updatedAt) * 1000);
```

This does not currently misrender anything: the only branches that omit
`updatedAtDate` are the zero-price ones, and those rows are filtered out by the
`item.priceToken <= 0.01` / `item.price <= 0` guards just above. So the buggy
fallback is unreachable today, and it stays that way only by coincidence.

The chart's prop type was widened to `updatedAt?: string | number` to make the
existing data shapes typecheck. That widening is a symptom, not the fix.

**To resolve:** normalise the hooks to emit one unit (milliseconds is the least
surprising), narrow the prop back to a single type, and correct or delete the
fallback.

## 4. Props that are accepted but never used

Each of these is declared in a component's props interface and passed by the
caller, but never read. They are not destructured any more, so the linter is quiet —
but a caller passing them still reasonably expects them to do something.

| Component | Prop | Note |
| --- | --- | --- |
| `CloseAllModal` | `onCloseAll` | Callback is never invoked; the "close all" completion is not reported back to the parent. |
| `DetailedSpecsModal` | `closeForm` | Callback is never invoked, so the modal cannot be dismissed from inside its own body. |
| `useAppkit` | `config.onConnect` | `onDisconnect` and `onError` are wired to effects; `onConnect` never is. |

**To resolve:** for each one, either wire it up or delete it from the interface and
the call site. Worth checking whether `DetailedSpecsModal`'s dismiss actually works
in the UI, since that one looks like a missing behaviour rather than a dead prop.

## 5. `useAppkit` is unreachable

**Where:** `src/hooks/useAppkit.ts`

Nothing in `src` imports it. Wallet connection goes through appkit directly. Either
it was superseded and should be deleted, or a migration to it was never finished.

## 6. `@types/node` (resolved)

Bumped to v24 to match Node 24 LTS. `vite-plugin-seed-meta.ts` now uses the `node:` import protocol.

## 7. Stale `node_modules/@wagmi/core`

**Where:** `ui/node_modules/@wagmi/core` — a real directory (version `2.17.3`), not a
pnpm symlink like every genuine dependency.

`src/components/Widgets/Futures/CloseAllModal.tsx` used to import `readContract`
from `@wagmi/core`, which is not in `package.json` and resolved to this leftover
directory. That import now goes through `wagmi/actions`, so nothing depends on the
directory any more and a clean `pnpm install` no longer breaks the build.

**To resolve:** it is safe to delete. It will disappear on the next
`rm -rf node_modules && pnpm install`.

## 8. Position direction is derived, not indexed

**Where:** `src/lib/positionDirection.ts` (`sessionIsLong`), used by the four
session mappers on both venues.

*Was: "Closed positions all read as Long." That defect is fixed; what is left is
the derivation that replaced it, which is sound but is doing the indexer's job.*

A `PositionSession` still does not say which way it was opened. Direction used to
be recovered by pulling **every fill of every session** and taking the sign of
the earliest one. That worked, and it was ruinously expensive: the fills were 98%
of the futures position book payload and 87% of the closed-session payload, on a
query re-fetched every 5 seconds. One live account was pulling ~17 KB of fills
every tick, about 12 MB an hour, growing with every fill it had ever made.

Sessions now carry **one** fill, selected as `lastFill`, and direction comes from
`sessionIsLong`:

- while the session is open, its `netQuantity` carries the sign;
- once it is flat, the fill answers instead. Only the fill that closes a session
  can leave `netQuantityAfter` at zero, so a zero means this fill traded against
  the position and the direction is the reverse of its sign; a non-zero is the
  position itself, which covers a session that expired while still open.

Verified against every session on both subgraphs — 21 closed sessions, futures
and perps — as well as all 16 open ones, against the old rule. The unit tests in
`positionDirection.test.ts` pin the cases, including that *any* fill of a session
yields the same answer, which is what makes it safe that two fills in the same
block cannot be ordered.

**Why this is still debt.** It is one nested row per session on a 5-second tick,
to recover a boolean the indexer already knows. It is also load-bearing in a way
that is easy to break: remove `lastFill` from a session query and direction
silently falls back to Long rather than failing.

**To resolve:** one field on `PositionSession`, either `isLong: Boolean!` or
making `maxQuantity` genuinely signed as its schema documentation already claims.
Then `sessionIsLong` reduces to reading it, `lastFill` comes out of all four
session queries, and this entry goes away.

> `maxQuantity` looks like it should already rescue this — its doc comment
> upstream and in `HistoricalPosition` describes it as signed — but it arrives
> unsigned. Its sign agreed with the session's real direction in 11 of 20 live
> futures sessions and 0 of 1 perps sessions, i.e. no better than a coin toss.
> Do not build on it before checking it again. The perps positions tab *was*
> reading direction off it, and was wrong for closed sessions because of it.

One ambiguity is worth settling when the field is defined: the two futures
mappers disagreed before any of this — `sessionToPosition` used the sign of the
*summed* fills, `sessionToHistoricalPosition` the sign of the *earliest* fill.
They differ only for a session that flips through zero.

**Deliberately not restored:** the row-level `transactionHash` on
`PositionBookPosition` and `HistoricalPosition`. It was derived from the latest
fill and nothing rendered it — every tx link in the UI comes from a `Trade` row,
which carries its own hash. Its one remaining use was a grouping key in
`FuturesTradesModal`'s perpetual branch, which that branch's own comment notes is
never reached.

---

## 9. The snapshot driver hand-rolls what React Query 5 already does

**Where:** `src/hooks/data/snapshot/driverRegistry.ts`,
`src/hooks/data/snapshot/snapshotFed.ts`

*Open decision — nothing here is broken, so this is a question of how much of
the machinery to keep, not whether to fix it.*

The registry coalesces concurrent callers onto one request, discards a cancelled
fetch that resolves late, and avoids re-rendering for data that did not change.
Measured against the installed `@tanstack/query-core 5.101.2`, the library does
all three: one cache entry per venue, with each consumer taking its slice
through `select`, would replace `driverRegistry`'s in-flight map and
`writeIfChanged`'s comparison and `startedAt` guard. The harness and the results
are in `QUERY_GROUPS.md`, "Could React Query do the fan-out itself?".

One reason survives the switch. A query still on its **first** fetch absorbs an
invalidation and hands the caller the request that started before it, which is a
condition in `Query.fetch` rather than a documented default. Applied here, a
transaction confirmed while a session's very first snapshot is in the air would
be served pre-transaction data — the one case `dropInFlightSnapshot` covers and
the library does not. The window is one request wide on a page that has no
tradeable data loaded yet.

Two pieces are dead regardless of what is decided: `hasSnapshotDriver` has no
caller outside its own test, and `runSnapshotOnce`'s no-driver path cannot be
reached on the trade pages, where both drivers mount whichever tab is open.

**To resolve:** pick one.

| Option | What it buys |
| --- | --- |
| Prototype the single-key + `select` design on a branch and measure what it deletes | *Recommended.* The case for it is on paper until a branch shows the deletion with the request count unchanged. |
| Spike only the v5 cancel-on-invalidate behaviour | Settles whether `dropInFlightSnapshot` is redundant, which is the only open question behind the option above, at a fraction of the work. |
| Remove the dead parts now — `hasSnapshotDriver` and the unreachable no-driver path | Safe on its own and independent of the rest, but leaves the duplication in place. |
| Leave it as is | It works and it is committed. Costs nothing today; the duplication stays until someone reads the registry and wonders why it exists. |

---

## Lint suppressions

Every `biome-ignore` currently in `src`, with the reason. Each one also carries an
inline comment at the call site.

### `useExhaustiveDependencies`

Adding the missing dependency would change behaviour in each of these, so they are
suppressed rather than "fixed".

| Location | Reason |
| --- | --- |
| `hooks/useOnMountUnsafe.ts` | Running once on mount is the hook's entire purpose; `effect` must stay out. |
| `hooks/data/usePaginatedHistory.ts` | `getId` is passed as an inline arrow by callers, so listing it would re-flatten every page on every render. |
| `pages/futures/Futures.tsx` | `contractMode` is the trigger, not a value read in the body — removing it stops the reset from running at all. |
| `components/Widgets/Futures/FuturesTradesModal.tsx` | `open` / `selection` are triggers, same as above. |
| `components/Widgets/Futures/ClosePerpsPositionModal.tsx` (seed effect) | `marketPrice` is read for the initial value only; listing it would re-reset the form on every price tick and discard user input. |
| `components/Widgets/Futures/ClosePerpsPositionModal.tsx` (`handleConfirm`) | Quantity is read via `form.getCurrentQuantity()`, so `form.amount` / `form.amountMode` are the real dependencies; `snapBigInt` is redefined every render. |
| `components/Widgets/Futures/ModifyPerpsOrderModal.tsx` (×3) | Same two patterns as `ClosePerpsPositionModal`. |
| `components/Widgets/Futures/OrderBookTable.tsx` (refetch on market change) | `selectedExpirationAt` is the trigger; `orderBookQuery` swaps between the futures and perps query objects, so listing its `refetch` fires an extra request whenever the mode flips. |
| `components/Widgets/Futures/OrderBookTable.tsx` (highlight tracking) | **Would loop:** the effect calls `setPriceHighlights`, and `finalOrderBookDataWithHighlights` is derived from that state. |
| `components/Widgets/Futures/PlaceOrderWidget.tsx` (slider sync) | The list enumerates the values `calculateMaxQuantity` / `getNumericAmount` read; both are redefined every render. |

Worth revisiting as a group if these components are ever refactored: several would
stop needing a suppression if the callbacks involved were memoised (`form.reset`,
`form.getCurrentQuantity`) — `scrollToOrder` in `OrderBookTable` was fixed exactly
that way and needed no suppression afterwards.

### `noExplicitAny`

| Location | Reason |
| --- | --- |
| `hooks/data/usePaginatedHistory.ts` (`mapRow`) | The row type cannot be expressed: `selectRows` returns `unknown[]` and all six callers pin `TRaw`/`TItem` explicitly, so a third generic for the row would never be inferred. Each caller's mapper declares its own concrete row type. |

### `noForEach`

| Location | Reason |
| --- | --- |
| `lib/formatUnits.test.ts` (file-level) | Table-driven tests; pre-existing. |
