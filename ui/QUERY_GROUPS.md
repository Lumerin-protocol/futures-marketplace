# Data fetching, grouped by lifetime

> **Status.** The grouping is implemented. Queries are declared as *slices* in
> `src/hooks/data/queries/`, each carrying its group, and each venue driver
> assembles its document per tick from the groups that are due
> (`snapshot/groupSchedule.ts`). What remains is step 1 below — folding every
> expiration's book into one query — plus the RPC-side items, which this change
> did not touch.

Originally the top-level split was by **venue** — one batched snapshot for futures, one
for perps, each ticking every 5s and each carrying a mix of things that never
change, things that change per account, and things that change per market. This
plan re-splits by **how long a value stays true**, which is what should actually
decide the refetch interval.

Two facts shape everything below:

- **Per-entity caching already works.** A driver doesn't cache anything itself:
  it fans its response out into separate react-query keys, and each of those is
  an ordinary query with its own `staleTime` and `gcTime`. What you can't do is
  give one *request* two intervals — which is exactly why the grouping matters.
- **There are four subgraph endpoints** (futures, perps, oracles, points). A
  request cannot span two of them, so the trade page costs at least three
  requests on a cold load. It costs five today, so there are two to win.

Group 1 in the original sketch — "margin requirements, contract addresses, fees"
— is almost entirely **RPC**, not indexer. Both are covered below, because they
have the same lifetime problem and the RPC side is in worse shape.

---

## Group 1 — Constants: fetch once, keep until reload

### Indexer

| Query | Endpoint | Today |
|---|---|---|
| `ContractSpecsQuery` → `["ContractSpecs"]` | futures | re-queried inside every 5s snapshot |
| `PerpsCollectionQuery` → `["PerpsCollection"]` | perps | re-queried inside every 5s snapshot |

Both carry tick size, quantity scale, fee bps and margin parameters. Neither
moves without a governance transaction, and both are re-fetched 720 times an
hour.

> `PerpsCollection` also carries `totalVolume`, which *does* move. Resolved by
> accepting a stale figure: it is a header stat, not a trading input, and
> splitting it would mean two cache writes for one entity to keep one number
> live. Recorded in the `collection` slice.

### RPC — immutable for the session

`vault()`, `collateralToken()`, `portfolioMargin()`, `getLinearMarkets()`, ERC20
`name`/`symbol`/`decimals` (both venues), `QUANTITY_DECIMALS()`.

These are already `staleTime: Infinity` and correctly handled — except
`QUANTITY_DECIMALS()`, which sits inside `usePortfolioSnapshot`'s 10-second
multicall wave and is therefore read every 10 seconds forever.

### RPC — slow-moving (governance)

`makerFeeBps`, `takerFeeBps`, the four margin-engine shock parameters, points
hook weights, `hook()`, the futures and perps contract constants,
`getExpirationDates()`.

Mostly at `staleTime: 300000`, which is right. Two exceptions worth fixing:
`useFuturesHook` has **no caching options at all**, so an address pointer
refetches on every window focus; and `getExpirationDates()` is read by two hooks
at two different intervals (see *Defects* below).

**Strategy.** `staleTime: Infinity`, `gcTime: Infinity`, no interval, no refetch
on mount or focus. Governance-mutable values get `staleTime: 300000` instead so a
long session eventually notices a parameter change.

---

## Group 2 — Account: one refetch cadence for everything about the user

| Query | Cache key | Endpoint |
|---|---|---|
| `FuturesOpenExposureQuery` | `["PortfolioOpenExposure","futures",address]` | futures |
| `PerpsOpenExposureQuery` | `["PortfolioOpenExposure","perpetual",address]` | perps |
| `VenueRealizedPnlQuery` (×2) | `["PortfolioRealizedPnl",venue,address,cutoff]` | both |
| `UserFuturesLiquidationsQuery` | `["UserLiquidations","futures",address]` | futures |
| `UserPerpsLiquidationsQuery` | `["UserLiquidations","perpetual",address]` | perps |
| `UserFuturesOrdersByStatusQuery` | `["Participant",address]` | futures |
| `PositionsBookQuery` | `["PositionBook",address]` | futures |
| `UserPerpsOrdersByStatusQuery` | `["UserPerpsOrders",address,…]` | perps |
| `UserPositionSessionsQuery` | `["UserPositionSessions",address]` | perps |

Open orders and open positions belong here rather than in group 3: they are
account-scoped and span every expiration, not just the market on screen.

RPC counterparts on the same cadence: `computePortfolioMargins`, `getRiskView`,
`getUserPosition`, `getOrderAggregate`, vault balance, wallet token balance.

**Strategy.** One request per endpoint — so **two** — on the same 5s interval as
group 3, so in the common case the two groups share a document and cost one
request between them. The interval is a single entry in `GROUP_INTERVAL_MS`, so
slowing the account down later is a one-line change. Invalidated eagerly by
`refreshVenueViews`, which also expires the venue's groups so the refetch reads
through the driver rather than each hook fetching alone.

---

## Group 3 — Market: only the market being looked at

| Query | Cache key | Endpoint | Scope |
|---|---|---|---|
| `AggregateOrderBookQuery` | `["AggregateOrderBook",expirationAt]` | futures | per expiration |
| `PerpsOrderBookQuery` | `["PerpsOrderBook"]` | perps | the perp |
| `RecentTradesQuery` | `["RecentTrades",venue,50]` | both | per venue |
| `FundingUpdatesQuery` | `["FundingRate"]` | perps | the perp |
| `OracleHourCandlesQuery` | shared by the three charts | oracles | per range |
| `HashrateIndexQuery`, `BtcPriceIndexQuery`, `NetworkHashrateIndexQuery` | `[series,timePeriod]` | oracles | per ticker + range |

RPC counterparts: `getMarketPrice()` (10s), `settlementPrice(expiration)` (10s).

**Strategy.** One request per **active** venue on a 5s interval. The charts stay
separate: they are on the oracles endpoint, they already coalesce into one
`OracleHourCandlesQuery`, and their `staleTime` is the bar interval — an hour on
5D — so they must not be dragged onto a 5s tick.

### The chart's newest bar — done

Leaving the charts alone left them up to a bar interval stale, which on 5D is an
hour. Refetching the range instead was never an option: a month of hourly bars
for the three series is 274 KB, so a 5s tick would be ~197 MB an hour.

Only the newest bar can still change, so that bar is fetched on its own and
spliced over the cached range (`lib/chartOverlay.ts`, `oracleOverlay.ts`). It is
assembled from one slice per series, so a series switched off in the legend is
not in the request at all — which is why the chart's visibility state now lives
in `Futures.tsx` rather than in `HashrateChart`.

Measured, hashprice only, which is the default: **249 B** on 1D, **266 B** on 5D,
**1.5 KB** on 1M. All three series on: 464 B / 509 B / 3.1 KB.

The splice returns the cached array unchanged when the bar has not moved, so the
common case — the oracle has not posted since the last tick — writes nothing and
re-renders nothing. Verified live: the overlay rebuilds the bar to the last digit
on all three ranges, so the chart does not step when the range behind it
refetches. That parity is held by sharing `oracleTickToAverage` and each series'
bar builder between the range fetch and the overlay, rather than by a second
copy of the arithmetic.

### Fetch every expiration's book, not just the selected one

The reason to widen the book is not that market switches are expensive — one
request on a deliberate user action is fine. It is that the book is scoped by
`expirationAt`, which arrives from `getExpirationDates()` over RPC *after* the
first snapshot has already gone out. The snapshot therefore carries no book, and
the order book hook always fetches for itself. That request is not a design
choice; it is forced by the sequencing.

Dropping the `expirationAt` filter and grouping levels by expiration on the
client removes the RPC dependency, so the first futures request carries the book,
and deletes the `AggregateOrderBookQuery` fallback and its startup race.

What it costs: the entire futures book across all three expirations is 34 price
levels — 15, 11 and 8 — against a page size of 100 for one market. Adding the
other two expirations to the snapshot document measured **+2.2 KB and no latency
change above run-to-run noise**, versus **+270 ms** for the separate request it
replaces (more in the browser, which also pays a CORS preflight once the 5 s
preflight cache has lapsed).

Worth a guard: if the combined book approaches the page limit, fall back to
per-expiration paging. Three markets at ~11 levels each leaves a wide margin, but
that margin is a property of the venue's liquidity, not a constant — on a busy
book this inverts, and the guard is what makes the inversion safe.

This group is where the current design leaks most — see the first two defects.

---

## Group 4 — On demand

| Query | Trigger |
|---|---|
| `HistoricalOrdersQuery`, `HistoricalPositionsQuery`, `UserFuturesTradesQuery` | history tabs; page 0 coalesced, pages 1+ on scroll |
| `UserPerpsOrdersExcludeStatusQuery`, `UserClosedPositionSessionsQuery`, `UserTradesQuery` | same, perps side |
| `HistoricalPositionsQuery` (full loop) | `FuturesTradesModal` open |
| `PointsLeaderboardQuery`, `UserPointsQuery`, `UserPointsMintsQuery` | `/leaderboard` route |
| `simulateOrder` (RPC, both venues) | order preview, manual refetch |
| `nonces(owner)` (RPC) | deposit permit flow |

Already close to right. `usePaginatedHistory` batches page 0 across the three
futures tables and pages the rest individually.

**Strategy.** No interval, ever. `staleTime` in the tens of seconds so a tab
switch doesn't refetch. Reset — not invalidate — after a transaction, so the user
lands back on the newest page.

---

## A fifth category the sketch is missing

**Transaction lifecycle.** `IndexedBlockQuery` (`snapshot/waitForIndexedBlock.ts`)
polls the subgraph's indexed head **every second for up to 30 seconds** after a
transaction, so the UI doesn't refetch at a block older than the one it just
wrote. It has no react-query entry and no interval in the ordinary sense — it is
an event-driven burst, and it does not belong in any of the four groups. Worth
naming explicitly because it is the single densest request pattern in the app.

---

## Queries missing from the original sketch

- **Funding rate** (`FundingUpdatesQuery`) — market data, group 3.
- **Public recent trades** (`RecentTradesQuery`) — the venue-wide feed, distinct
  from the user's own trades.
- **Points and leaderboard** — three queries on a fourth endpoint, a different
  route entirely.
- **Settlement price per expiration** — RPC, market-scoped, polled every 10s.
- **Order simulation** — RPC, on demand.
- **The deep-book pagination path** — when a book exceeds 100 levels the driver
  issues extra requests on the same tick.
- **`IndexedBlockQuery`** — see above.

### Dead or unreachable, safe to delete

- `AggregatedHashrateIndexQuery` — exported, zero imports.
- `UserPerpsOrdersQuery` — every caller passes statuses, so this branch is
  unreachable.
- `useGetPerpsOrderMargin` / `useGetMinMargin` — implemented, no call sites,
  polling every 10s if ever mounted.
- `CloseAllModal`'s imperative `readContract` — component isn't imported.

---

## Defects the grouping exposes

1. ~~**Both venues poll on every trade page.**~~ **Fixed.** Both drivers still
   mount — the portfolio header states the whole account regardless of tab — but
   each is told whether it is the active venue, and the inactive one drops its
   market slices. Measured on a live account: the futures tick falls from 41.4 KB
   to 23.6 KB when you are looking at perps, and the perps tick from 19.1 KB to
   12.9 KB when you are looking at futures.
2. **Recent trades polled but usually invisible.** The snapshot fetches 50 trades
   per venue every 5s; `TradesList` only mounts on the order book's Trades
   sub-tab.
3. **`getExpirationDates()` read twice at different intervals** — 15s from
   `useGetExpirationDates`, 10s from `usePortfolioSnapshot`, same cache key.
   Two observers fighting over one entry.
4. **`getRiskView` fetched twice under different ABIs**, so the query keys differ
   and multicall can't dedupe them.
5. **Vault balance never polls** while the wallet token balance polls every 15s —
   the collateral figure is the one that moves when you trade.
6. **Realized PnL key contains an hourly cutoff**, so it allocates a fresh cache
   entry every hour and the old one lingers until `gcTime`.
7. **Paginated history has `staleTime: 0`**, so every window focus refetches
   every loaded page.
8. **`useHashpriceCandles` doesn't use the shared retry policy** its three
   siblings use.
9. ~~**The three index charts disagreed on what counts as a sample.**~~ **Fixed.**
   Hashprice dropped a tick priced `"0"`, BTC also dropped a missing one, and
   network hashrate dropped nothing — three spellings of one intent, none of
   which ever fired: a month of every series has no zero, missing, negative or
   unparseable reading. They are now one `oracleTickToAverage`, which keeps a
   reading only if it is greater than zero.

---

## What each group costs

A group is a **caching and refetch policy, not a request boundary**. Groups 1, 2
and 3 for one endpoint are one request; membership decides whether an alias is
included in *this tick's* document, not whether it gets a request of its own.

That is what makes the document shrink over time. The first tick asks for
everything. The second asks only for what has gone stale — constants never
appear again, account slices appear every other tick, market slices every tick.
GraphQL makes this free: the driver assembles the document from whichever groups
are due.

Trade page, wallet connected:

| | Cold load | Steady state, futures tab |
|---|---|---|
| Before | 5 requests | futures 59 KB + perps 19 KB, every 5s |
| Now | 4 requests | futures 41 KB + perps 13 KB, every 5s |
| After step 1 | **3 requests** | unchanged |

The steady-state saving is the perps tick shedding its book, trade feed and
funding rate while nobody is looking at perps, plus both venues' constants
dropping out after the first tick. The cold load is still four because the order
book has to wait for `getExpirationDates()` over RPC; step 1 is what removes
that, and it is the last request between here and the three-endpoint floor.

### Session fills are no longer fetched — done

`PositionSession.trades[]` was selected by four documents, two of them on the
**5-second tick**, and it was by far the heaviest thing the UI fetched. Nothing
rendered it outside `FuturesTradesModal`. It has been removed from all four;
the modal now fetches fills for the sessions it is actually showing, through
`SessionTradesQuery` / `useSessionTrades`.

Measured against the same live account before and after:

| Query | Before | After |
|---|---|---|
| `PositionsBookQuery` (5 s tick) | 17.4 KB | **1.4 KB** |
| `FuturesSnapshotQuery` (5 s tick) | 58.9 KB | **42.8 KB** |
| `FuturesHistoryFirstPageQuery` | 26.9 KB | **13.1 KB** |
| `HistoricalPositionsQuery` | 15.9 KB | **2.2 KB** |

The row-level `transactionHash` went with it: it was derived from the latest
fill and never rendered, since every tx link in the UI comes from a `Trade` row
carrying its own hash.

Perps followed, for the same reason: its sessions rode the 5-second tick with
every fill attached, and only its trade-details modal rendered them. That modal
now fetches its own, and the perps tick fell by 2.7 KB on an account with a
single seven-fill session — a saving that grows with every fill the account
makes.

**Direction was the only thing the fills were load-bearing for**, and it is now
one nested row per session rather than all of them: `lastFill`, resolved by
`sessionIsLong`. A closed session is flat, so the fill that closed it traded
against the position and its sign is reversed. Verified against every session on
both subgraphs. This also fixed perps, which read direction off `maxQuantity` and
was wrong for closed sessions because that field arrives unsigned. What remains
is TECH_DEBT.md §8: one field on `PositionSession` in the indexer would delete
the derivation entirely.

### Merging has a price, and it is not zero

A request costs about **270 ms of fixed round-trip overhead** regardless of size,
so collapsing two requests into one is usually a large win. But the merged
request's own latency grows with its payload, and past a point that eats the
saving. Measured on the futures endpoint against an account with real history:

| Futures request contents | Payload | Median |
|---|---|---|
| Snapshot, book for one expiration | 59 KB | 622–811 ms |
| \+ books for the other expirations | 61 KB | unchanged within noise |
| \+ first page of the three history tables | 88 KB | +100 to +153 ms |

Run-to-run variance on an identical query is ±200 ms, which swallows the book's
2 KB but not history's 27 KB — that one is consistently positive across runs.

That made folding history in look like a real trade. It stopped being one once
the fills were removed, because they were most of the weight on both sides:

| Futures cold request | Before | Now |
|---|---|---|
| Snapshot | 59 KB | 42.8 KB |
| \+ all three books | 61 KB | ~45 KB |
| \+ history first page | 88 KB | **~58 KB** |

So the fully merged request ends up *smaller than the old snapshot alone* while
carrying strictly more: three books instead of one, plus the history page. One
request, and the 100–150 ms that history cost mostly went with the fills.

The rule to keep, though, in case a future slice is genuinely large: **merge by
what the first paint needs, then by refetch cadence.** Something big and not
immediately visible belongs in a parallel second request, not the first one.
Here nothing qualifies once the fills are removed.

---

## Code organization

Implemented, and it turned out smaller than the sketch below it predicted.

**Queries are declared one root field at a time.** A `Slice`
(`queries/slice.ts`) owns an alias, its variables, its group, and the whole root
field — arguments included, not just the selection set. Documents are assembled
from slices, so the batched tick and a hook fetching for itself are built from
the same text and cannot return different rows.

That last part is why the reuse unit is the field and not the field list. The old
`*_FIELDS` constants shared the selection but not the `where:` clause, and two
pairs had already drifted: the standalone book query had an `id_gt` cursor its
batched copy lacked, and the standalone orders query had a `skip` the batch
lacked. Both are now one definition.

```
hooks/data/queries/
  slice.ts        // the model, and buildDocument
  common.ts       // slices valid against both venue subgraphs
  futures.ts      // futures slices, then the documents built from them
  perps.ts        // same for perps
  oracles.ts      // plain gql: nothing here is on a tick
  inventory.test.ts   // the audit — see below
hooks/data/snapshot/
  groupSchedule.ts    // which groups a venue is due this tick
```

**Groups turned out to be a document-assembly rule, not three drivers.** Three
drivers each on their own interval would mean *more* requests per endpoint, not
fewer. Instead one driver per venue keeps ticking at 5s and calls `dueGroups()`,
which answers with the groups whose interval has elapsed; `slicesForTick()` turns
that into a document. So the registry stays keyed by venue, and `(group, venue)`
is not needed.

Assembling per tick also deleted `$hasAddress`, `$hasExpiration` and every
`@include` directive. A slice that does not apply is simply not in the document,
which is both smaller on the wire and easier to read.

### Auditing

`queries/inventory.test.ts` holds the inventory as a table — every alias and its
group, for both venues — checked against the slice files. Adding, removing or
regrouping a query fails that test until the table is updated, so the diff on
that one file is the record of what the app asks the indexer for and how often.

It also checks the properties that assembly could silently break: every document
declares the variables it uses, every document selects `_meta`, no `history`
slice can acquire a tick, the shared slices are the *same object* on both venues
rather than a copy, and the batched history page is byte-identical to the three
single-table documents.

**Suggested order.**

0. ~~**Drop session fills**, moving them behind the trades modal.~~ Done.
   Leaves one thing outstanding: a signed direction on `PositionSession` in the
   indexer, which is what makes closed positions report their side correctly
   again (TECH_DEBT.md §8).
1. **All expirations in the book query.** Not done — the only remaining step.
   Contained, measured at ~2 KB, and it removes the cold-start race and the one
   request still forced by waiting on `getExpirationDates()` over RPC. Market
   switching becoming instant is a bonus rather than the point. Needs the
   page-limit guard.
2. ~~**Group 1 out of the tick.**~~ Done.
3. ~~**Group 3 gating.**~~ Done.
4. ~~**Group 2.**~~ Done, on the same 5s cadence as group 3 rather than a
   separate 10s one.

The remaining defects in the list above are all RPC-side except #2 (recent trades
polled while the Trades sub-tab is closed), which the group machinery can now
express — it needs the driver to know which sub-tab is open, the same way it now
knows which venue is on screen.
