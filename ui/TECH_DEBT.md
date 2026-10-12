# Tech debt — `ui`

Known issues that were deliberately deferred, and every lint suppression that is
still in the codebase. Added while bringing `pnpm typecheck` and
`pnpm exec biome lint src` to zero diagnostics.

`pnpm typecheck` is green and `biome lint src` is green. The repo-wide `pnpm lint`
is not: `scripts/measure-bundle.mjs` carries four `noAssignInExpressions` errors
(§24). If `typecheck` or `biome lint src` starts reporting, something below
probably regressed.

Most entries here are things that are merely untidy. **§8 is the one that needs
somebody else: the UI derives position direction because the indexer does not
expose it, and one field upstream would delete the derivation.** **§9 is the one
that needs a decision before any work starts.** §10 onwards came out of a review
of the branch against `dev` before merge; each names what was checked and what
was deliberately left.

---

## 1. AppKit and wagmi must remain on one dependency stack

**Where:** `package.json`

AppKit `1.8.21` originally auto-resolved `@wagmi/core@3.5.5` and
`@wagmi/connectors@8.0.20` while the application itself used wagmi v2/core v2.
That split could make `useAccount` report a restored session while
`useWalletClient` could not resolve its connector.

The app now pins `wagmi@3.6.21`, whose exact core and connector dependencies
match AppKit's. Keep AppKit and wagmi upgrades coordinated so the tree does not
split again. Downgrading only connectors to v6 also regresses AppKit's automatic
MetaMask-extension handoff.

**Must be retested manually after any change here:**

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

**Known edge the rule cannot answer:** a session opened and closed inside one
transaction. The indexer folds a user's fills per `(tx, user, session)` into one
`Trade`, so two opposite legs in one tx leave `tradeQuantity = 0` and
`netQuantityAfter = 0`, and `sessionIsLong` returns Long whichever way it was
opened. Dev's sum-of-fills rule gave the same answer, so this is not a
regression, and whether the contract can produce the case at all (a self-match)
was not established. The indexer field above settles it either way.

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

## 10. Snapshot schedule: timing edges that cost a tick

**Where:** `src/hooks/data/snapshot/groupSchedule.ts`,
`src/hooks/data/snapshot/snapshotFed.ts`, `src/hooks/data/useSettlePositions.ts`,
`src/hooks/data/useLiquidationNotifications.ts`

None of these show wrong data for longer than one tick, which is why they were
left. Each is a one-line fix once someone is in the file.

- **A forced read re-phases the schedule.** A fed hook with an empty cache calls
  `runSnapshotOnce(venue, true)`, and `markRequested` stamps the group at that
  moment, while the driver's `refetchInterval` keeps its own phase. Driver ticks
  at t=5, 10, 15; a forced read at t=7 means that at t=10 `elapsed` is 3s, the
  document is empty and nothing is sent; the next data is at t=15. The slack in
  `TIMER_SLACK_MS` was meant to prevent exactly this gap, but only covers timer
  jitter. *Fix:* re-anchor the driver's interval to the forced read, or compute
  `elapsed` against the driver's last tick rather than any caller's.
- **The fallback path has no `startedAt` guard.** `writeIfChanged` discards a
  snapshot that lands after a newer one, but when `readViaSnapshot` falls back
  to the hook's own `fetchX`, React Query writes that result itself. A fallback
  started at T0 can overwrite a tick started at T1 > T0 and hold the older rows
  until the next tick. *Fix:* route fallback results through `writeIfChanged`,
  or drop the fallback on the trade pages (see §9, the no-driver path).
- **`useSettlePositions` invalidates without expiring the schedule.** After
  `waitForIndexedBlock` it calls `invalidateQueries([POSITION_BOOK_QK, account])`
  but not `dropInFlightSnapshot` / `expireVenueGroups`, unlike `refreshVenueViews`.
  The refetch can join a tick issued before the block was indexed and read the
  settled position back for one more tick. *Fix:* call `refreshVenueViews` or
  the two helpers.
- **Liquidation watermark primes per venue.** Priming waits on
  `perps.isPending || futures.isPending`; a venue whose whole tick failed (the
  cold-load rate limit) is in `error`, so the watermark is primed from the other
  venue only. When that venue heals a tick later, every historical liquidation
  on it is "fresh": a burst of toasts and a `refreshVenueViews` for old events.
  *Fix:* prime only once both venues have returned data at least once, or
  persist the watermark per venue.
- **Schedule stamps are keyed by venue, not address.** `lastRequested` is
  `${venue}:${group}`; if the address changed within one interval the account
  group would not be due, and every address-keyed fed hook would fall back on
  its own. `Futures.tsx` reloads the page on any address-to-address change, so
  this cannot happen today; it becomes real the day that reload is removed.
  *Fix when that happens:* include the address in the stamp, or call
  `expireVenueGroups` when the runner's address changes.
- **Leftovers.** `snapshot/waitForIndexedBlock.ts` carries a session comment
  ("user changed this to 2000, please keep it") where a reason should be;
  `QUERY_GROUPS.md` still says the indexed-block poll runs "every second";
  `FuturesSnapshotResult.groups` is read only by tests.

## 11. Overlay writes keep the chart range query permanently fresh

**Where:** `src/hooks/data/oracleOverlay.ts`, `src/hooks/data/useHashRateIndexData.ts`,
`src/hooks/data/useBtcPriceIndexData.ts`

The in-progress bar is spliced over the cached range with `qc.setQueryData`,
which bumps `dataUpdatedAt`. On 5D the range query has `staleTime` of an hour,
so while the oracle keeps posting it never goes stale. Two consequences in a long
session: the window's left edge never slides, and the last *closed* bar freezes
as of the final overlay tick before the hour boundary, so a post indexed a few
seconds into the next hour is never folded into the previous bar. Self-limiting
and gone on reload.

**To resolve:** write the splice with `updatedAt` preserved
(`setQueryData(key, updater, { updatedAt })`), or drive the range refetch from a
bucket-boundary timer instead of `staleTime`.

## 12. Price charts include the in-progress hour again (reverses #309)

**Where:** `src/hooks/data/oracleCurrentBucket.ts`, `src/hooks/data/queries/oracles.ts`

Dev commit `320206a2` (#309) set `current: exclude` on the aggregated range
queries because graph-node emits an empty current bucket with null non-null
fields (graphprotocol/graph-node#6719) and the whole response fails. This branch
makes `$current` a variable and asks for `include` first, so the newest bar is
live, falling back to `exclude` only on that one error. A deliberate product
change — the overlay reads the bar in progress every few seconds, which is
pointless if the bar is excluded — but it undoes a dev fix without saying so in
the PR, and in the minutes after each hour boundary, before the oracle's first
post, every overlay tick costs two requests on the oracles endpoint.

**To resolve:** nothing, if the live bar is wanted. If the double request
matters, remember the `exclude` fallback until the next bucket boundary instead
of retrying `include` on every tick.

## 13. `Tooltip`: behaviour deltas from the MUI component it replaced

**Where:** `src/components/Tooltip.tsx`

The port covers hover and focus, the enter delay, Grow timing, flip and viewport
clamping. These are the places where it still differs, none of them in a flow
that places or closes an order:

- **Re-hover within the 200ms exit is invisible.** `hide()` sets `entered=false`
  and schedules the unmount; `show()` inside that window cancels the unmount but
  `entered` is only set by the effect keyed on `[mounted]`, which does not re-run.
  The bubble stays mounted at `opacity: 0` until the next full leave.
- **No re-measure on `title` change.** The layout effect depends on
  `[mounted, placement, arrow]`, so "Copy to clipboard" → "Copied!"
  (`DetailedSpecsModal`) shrinks anchored to the left instead of staying centred.
- **Only the four cardinal placements.** `top-start` etc. are not supported;
  `DetailedSpecsModal`'s backstop tooltip was changed from `top-start` to `top`
  in the dev merge for that reason.
- `disableHoverListener` also suppresses the focus trigger (MUI disables hover
  only); there is no Escape dismissal; on touch a tap shows the tooltip at once
  (MUI required a long-press) and it stays until a tap elsewhere.
- `cloneElement(children, { "aria-describedby": … })` overwrites a child's own
  `aria-describedby` with `undefined` while closed. No current caller passes one.

**To resolve:** set `entered` from `show()` directly, add `title` to the layout
effect's deps, and decide whether `-start`/`-end` placements are worth the
arrow arithmetic. The rest is a judgement call against MUI parity.

## 14. `Modal`: missing dialog semantics and two close-on-mousedown edges

**Where:** `src/components/Modal.tsx`

Focus trap, return-focus, scroll lock with scrollbar-gap compensation and the
fade timing are all in place. What is not:

- **No `role="dialog"` / `aria-modal="true"` on the container.** Only
  `AlertModal` adds `role="alertdialog"` itself; every `ModalItem` / `Modal`
  caller (deposit, withdraw, close position, modify order, trades) is an
  unlabelled region to assistive technology. MUI's Dialog set both.
- **Grabbing the overlay scrollbar closes the modal.** `onMouseDown` on the
  scrolling `Container` closes when `target === currentTarget`; a mousedown on
  the container's own scrollbar satisfies that. MUI paired a mousedown-origin
  check with `click`, which scrollbars do not produce. Affects any card taller
  than the viewport. *Fix:* require a matching `mouseup`/`click` on the same
  target, or ignore mousedowns whose `clientX` is inside the scrollbar gutter.
- **First focus lands on the Close button**, not on the dialog itself as MUI
  did, so a screen reader announces "Close, button" before the title. Needs an
  AT pass to decide whether it matters.

## 15. `Select`: closes on any scroll, and dropped MUI menu behaviour

**Where:** `src/components/Select.tsx`, `src/components/Widgets/Futures/MarketSelector.tsx`

- **Closes on any scroll.** A capture-phase `scroll` listener on `window` calls
  `close()`. Capture-phase listeners fire for scroll events on *any* element,
  including the menu's own `Paper` (`overflow-y: auto`), so scrolling a long
  option list, or a wheel event that chains to the page, snaps the menu shut.
  MUI locked page scroll and never closed on scroll. *Fix:* ignore events whose
  target is inside the paper, or lock scroll while open as the modal does.
- **`displayEmpty` is accepted and ignored** (`renderValue` is always called);
  `MenuItemProps.className` is dropped; there is no typeahead; closing by
  outside click does not restore focus to the trigger.
- **`MarketSelector` lost its menu styling.** The MUI `MenuProps.PaperProps.sx`
  (`maxHeight: 360`, `border`, `marginTop: .25rem`) and the `0.875rem` item font
  had no equivalent in the new `Paper`, which has no border or offset and
  `1rem` options. The new trigger also gains a hover border that the file's own
  comment says the header should not show.

## 16. Small widget leftovers from the MUI removal

| Where | What | Fix |
| --- | --- | --- |
| `Widgets/Futures/PerpsOrderFormFields.tsx` | `.MuiSlider-marked { margin-bottom: 12px }` became `[role="slider"] { … }`, but the new `Slider` sets no `role` (the hidden `<input type="range">` has an implicit one only), so the override matches nothing and the compact perps form keeps the 20px gutter. | Target the slider's root class or expose a class on `Root`. |
| `components/Spinner.styled.tsx` | `styled.div<{ fontSize?: string }>` — next-yak strips only `$`-prefixed props, Emotion's `isPropValid` used to drop this one. Unknown-prop warning in dev, a junk `fontsize` attribute in prod. Callers: `PlaceOrderWidget`, `HashrateChart`. | Rename to `$fontSize`. |
| `components/TextField.tsx` | `{...inputProps}{...rest}` is followed by the component's own `onFocus` / `onBlur` / `onChange`, so any handler passed in `inputProps` is silently discarded. Only caller passes `min` / `step`. | Compose the handlers or drop `inputProps` from the type. |
| `components/icons.tsx` | `sx` is still part of `IconProps`; no caller passes it. | Delete. |
| `components/Alert.tsx` | No longer imported anywhere. Its vertical placement also changed (centred Dialog → `margin: 3rem auto`). | Delete. |
| `components/Slider.tsx` | `@media (hover: none) { box-shadow: none }` precedes `@media (max-width: 768px) { box-shadow: 0 0 0 4px }`, so on a touch phone the later rule wins and the hover halo sticks after a tap. Same order as before the migration, so probably not a regression; confirm on a device. | Merge into one query or reorder. |

## 17. Icon substitutions that changed meaning or weight

**Where:** `src/components/icons.tsx`

Heroicons stand in for Material glyphs. The mappings that are not like-for-like:
`HelpIcon` (filled) and `HelpOutlineIcon` now render the same outline glyph;
`FlagCircleIcon` → `FlagIcon` (no circle); `ShieldIcon` → `ShieldCheckIcon`
(adds a check); `SkipNext` → `ForwardIcon`. Heroicons outline paths are 1.5px
strokes at 24px, so at `fontSize: 13` (`TradesList`) and `0.75rem`
(`TradingHeader`) they draw at under 1px and look far lighter than the filled
Material icons they replace. The chart toggle already inlines Material's own
paths for this reason.

**To resolve:** inline the Material paths for the small-size uses too, or use
the heroicons `20/solid` set where a filled glyph was replaced.

## 18. Hidden sourcemaps are deployed to the public bucket

**Where:** `vite.config.ts` (`sourcemap: "hidden"`),
`.github/workflows/deploy-futures-ui.yml` (`aws s3 sync build/ … --delete`)

`hidden` omits the `//# sourceMappingURL` comment but still writes the `.map`
files — 141 of them, 18 MB against 6.4 MB of JS and CSS — and the deploy syncs
the whole `build/` directory. Anyone who requests `<chunk>.js.map` gets the
original TypeScript. Pre-existing on `dev`; this branch's measurement scripts now
*depend* on the maps being emitted, which locks the setting in.

**To resolve:** `aws s3 sync --exclude "*.map"`, or delete the maps after
`measure:bundle` has read them.

## 19. The browser floor rose with Vite 8's default target

**Where:** `vite.config.ts` (no `build.target`)

Vite 6 defaulted to `modules` (Chrome 87, Safari 14). Vite 8 defaults to
`baseline-widely-available` (Chrome 111, Edge 111, Firefox 114, Safari 16.4,
iOS 16.4). The `browserslist` in `package.json` is read by autoprefixer only.
Nothing in the PR states the new floor. For a wallet-facing app the in-app
browsers on older iOS are the population to think about.

**To resolve:** pin `build.target` explicitly, whichever floor is chosen, so
the next Vite major cannot move it silently again.

## 20. `viem` is bundled twice

**Where:** `build/assets/chunks/dist-*.js` (see `pnpm measure:bundle`)

A full CJS copy of viem (334 `viem/_cjs/**` sources, ~590 KB raw / 149 KB gzip)
rides in with `@safe-global/safe-apps-sdk` → `@safe-global/safe-apps-provider`,
next to the ESM copy the app uses. It is lazy — loaded with the Safe connector —
so it does not touch first paint, but it is the fourth-largest chunk. Same lock
entries exist on `dev`, so not introduced here. `measure-bundle.mjs`'s
`packageOf()` keys by package name regardless of `_cjs` / `_esm`, so the README's
"viem 966 KB" undercounts it.

**To resolve:** check whether a newer `safe-apps-sdk` ships ESM, or alias
`viem/_cjs` to the ESM build in Rolldown; split `packageOf()` by `_cjs` so the
duplication shows up in the report.

## 21. The `@walletconnect/ethereum-provider` override never fires

**Where:** `pnpm-workspace.yaml`

The override exists to stop `@wagmi/connectors` from pulling a second
WalletConnect stack that shares `WALLET_CONNECT_V2_INDEXED_DB` with
`@reown/appkit`. In the current tree `pnpm why @walletconnect/ethereum-provider`
prints nothing: it is an *optional* peer of `@wagmi/connectors`, and pnpm's
`autoInstallPeers` does not install optional peers, so no second stack exists
and the override has nothing to act on. The comment above it ("is auto-installed
as an optional peer") describes a mechanism that does not run. The real
protection is that nothing declares it as a hard dependency.

**To resolve:** keep the override as a guard, correct the comment, and add a
`pnpm why` check to §1's retest list.

## 22. Measurement scripts and the baseline snapshots

**Where:** `scripts/measure-*.mjs`, `scripts/baseline/`

- `measure:baseline` without `--out` writes `scripts/baseline/latest.json`,
  which is not ignored, so running the documented command dirties the tree.
- `emotion-before.json`, `vite8-react19.json` and `no-mui.json` all record
  `git: 459c738d` for three different stacks: they were taken on dirty working
  trees and the script records only `rev-parse --short HEAD`. Add a dirty flag
  and a lockfile hash.
- 29% of raw JS is `(unmapped)` (the seed-JSON chunks have no mappings), so every
  bucket percentage in the README is a share of *mapped* bytes; the README does
  not say so.
- The yak step's table reports the first-load shell at −14 KB gzip, which is
  right, but the entry chunk itself grew 89 → 107 KB gzip in the same step.
  Not wrong, but selective.
- `measure-runtime.mjs` needs Playwright's Chromium (`playwright install
  chromium`); the README does not say so.

## 23. Dependencies: unused, mis-declared, and the audit summary

- **Unused on both `dev` and this branch** (0 imports in `src`):
  `react-circular-progressbar`, `react-minimal-pie-chart`, `react-timer-hook`,
  `react-fast-compare`, `ecies-geth`, `buffer`, `pretty-ms`,
  `@tanstack/react-table`. `build:analyze` references `vite-bundle-analyzer`,
  which is not installed.
- `react-safe-lazy@0.1.0` declares `peer react ^18`; it only imports `lazy`, so
  it works on 19, but shows as unmet on every non-frozen install.
- `TextField.tsx` still uses `forwardRef`; fine on React 19, ref-as-prop would
  shorten it.
- `pnpm audit --prod`: 1 critical (`elliptic` via `contracts-js` → `ethers`),
  9 high (`axios` via `@base-org/account`, `hono` via `porto`, `source-map-js`
  via `postcss`, `react-router` server-mode CSRF). None of `elliptic`, `ethers`,
  `axios`, `hono`, `source-map-js` appear in any production sourcemap, and the
  `react-router` advisory is RSC/server-only; `ws` (via `viem` → `isows`) is in
  the bundle but is a Node DoS. Re-check after each lockfile change.

## 24. Lint and tests are not enforced in CI

- `pnpm lint` is red: `scripts/measure-bundle.mjs` has four
  `lint/suspicious/noAssignInExpressions` (`while ((m = re.exec(text)))`). Lint
  is not run in CI, so nothing caught it. `dev` already had two
  `useNodejsImportProtocol` errors in `load-env.ts` under the same config.
- The 26 Vitest files (382 tests) only run with the full app env
  (`APP_ENV=dev REACT_APP_WALLET_CONNECT_ID=… ALCHEMY_API_KEY=…`) because
  `vite.config.ts` validates env at load; there is no `test` script and CI never
  runs them. The Vitest 3 → 5 and React 19 bumps therefore have no CI coverage.
- `deploy-futures-ui.yml` uses `actions/checkout@v4`, `actions/setup-node@v4`
  and `pnpm/action-setup@v4`, which GitHub now forces onto the Node 24 runtime
  with a deprecation warning.
- `prepare: husky` runs from `ui/` where there is no `.git`, so the hooks are
  never installed and `.husky/pre-commit` (`npm run format`) is dead.

**To resolve:** add `biome lint` and `vitest run` (with a CI env file) to the
UI workflow; bump the actions; move husky to the repo root or drop it.

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
