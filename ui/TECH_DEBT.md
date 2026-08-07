# Tech debt — `ui`

Known issues that were deliberately deferred, and every lint suppression that is
still in the codebase. Added while bringing `pnpm typecheck` and
`pnpm exec biome lint src` to zero diagnostics.

Both commands are green as of this document. If either starts reporting again,
something below probably regressed.

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

## 6. `@types/node` is pinned at v12

**Where:** `package.json` (`"@types/node": "^12.20.19"`), `vite-plugin-seed-meta.ts`

v12 predates the `node:` module protocol, which `@types/node` only started declaring
in v16. Rewriting `import ... from "fs"` to `"node:fs"` in the build-tooling files
therefore fails `tsc --noEmit` with `TS2307: Cannot find module 'node:fs'`, even
though it is the form Biome (and Node itself) prefers. The rule is suppressed at the
top of `vite-plugin-seed-meta.ts` instead.

**To resolve:** bump `@types/node` to something matching the Node the project
actually runs on (the repo requires Node 22), then drop the suppression and use the
`node:` prefix. Expect the bump to surface unrelated type errors, which is why it was
left out of this pass.

## 7. Stale `node_modules/@wagmi/core`

**Where:** `ui/node_modules/@wagmi/core` — a real directory (version `2.17.3`), not a
pnpm symlink like every genuine dependency.

`src/components/Widgets/Futures/CloseAllModal.tsx` used to import `readContract`
from `@wagmi/core`, which is not in `package.json` and resolved to this leftover
directory. That import now goes through `wagmi/actions`, so nothing depends on the
directory any more and a clean `pnpm install` no longer breaks the build.

**To resolve:** it is safe to delete. It will disappear on the next
`rm -rf node_modules && pnpm install`.

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
| `components/Widgets/Futures/OrderBookTable.tsx` (target-expiry snap) | With `selectedDateIndex` listed, paging the carousel by hand snaps straight back to the target. |
| `components/Widgets/Futures/OrderBookTable.tsx` (expiry notification) | `onExpirationAtChange` is a new function on every parent render, so listing it fires the notification on every render. |
| `components/Widgets/Futures/OrderBookTable.tsx` (refetch on expiry change) | `selectedDateIndex` is the trigger; `orderBookQuery` swaps between the futures and perps query objects, so listing its `refetch` fires an extra request whenever the mode flips. |
| `components/Widgets/Futures/OrderBookTable.tsx` (highlight tracking) | **Would loop:** the effect calls `setPriceHighlights`, and `finalOrderBookDataWithHighlights` is derived from that state. |
| `components/Widgets/Futures/PlaceOrderWidget.tsx` (slider sync) | The list enumerates the values `calculateMaxQuantity` / `getNumericAmount` read; both are redefined every render. |

Worth revisiting as a group if these components are ever refactored: several would
stop needing a suppression if the callbacks involved were memoised (`form.reset`,
`form.getCurrentQuantity`, `onExpirationAtChange`) — `scrollToOrder` in
`OrderBookTable` was fixed exactly that way and needed no suppression afterwards.

### `noExplicitAny`

| Location | Reason |
| --- | --- |
| `hooks/data/usePaginatedHistory.ts` (`mapRow`) | The row type cannot be expressed: `selectRows` returns `unknown[]` and all six callers pin `TRaw`/`TItem` explicitly, so a third generic for the row would never be inferred. Each caller's mapper declares its own concrete row type. |

### `noForEach`

| Location | Reason |
| --- | --- |
| `lib/formatUnits.test.ts` (file-level) | Table-driven tests; pre-existing. |

### `useNodejsImportProtocol`

| Location | Reason |
| --- | --- |
| `vite-plugin-seed-meta.ts` (file-level) | `@types/node` is pinned at v12 and cannot resolve `node:fs` / `node:path`. See section 6. |
