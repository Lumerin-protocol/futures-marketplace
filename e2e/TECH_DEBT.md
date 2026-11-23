# Tech debt — `e2e`

Deferred work and known limits of the Playwright suite. Local runs work without
fixing any of this; items below matter when extending coverage.

---

## 1. Trades and Order History have no `data-testid`s

**Where:** `ui/src/components/Widgets/Futures/OrdersPositionsTabWidget.tsx`,
`PerpsOrdersPositionsTabWidget.tsx`; `e2e/src/pages/AccountTables.ts`;
`ui/src/testids.ts`

Open Orders, Positions and Position History wrappers carry testids. Trades and
Order History wrappers do not. `AccountTables` already types those tab names, but
`open("Trades")` / `open("Order History")` do not wait on a table root.

**Blocks:** smoke-manual §5–7 assertions on fill rows in Trades and related rows
in Order History.

**To resolve:** add `TESTIDS.tradesList` / `orderHistoryList`, put them on both
venue wrappers, and add read/find helpers on `AccountTables` like the history
helpers.

---

## 2. No market-maker / book health preflight

**Where:** `e2e/src/global-setup.ts`

Setup logs wallet ETH/USDC. It does not check that the dev book is two-sided.
When the market maker is down, `40-order-match-close` (and similar) fail with
long indexer/UI timeouts instead of a clear skip or setup error.

**To resolve:** in global setup (or a shared skip), assert best bid and best ask
exist on the target venue; skip match/close with an explicit reason when not.

---

## 3. Market selector flakiness (Select closes on scroll)

**Where:** `ui/src/components/Select.tsx`; workaround in
`e2e/src/pages/MarketSelector.ts`

The Select menu closes on any page scroll. The futures order book re-centres
itself when levels load, which can close the menu under the cursor. Page objects
retry open-and-pick; any new market-switching test inherits that flake risk.

**To resolve:** stop closing the Select on unrelated scroll (or ignore scroll from
the order book). Then drop the retry loops in `MarketSelector`.

---

## 4. Coverage gaps vs the smoke manual

Documented as out of scope in the suite today; page-object hooks are partial.

| Manual | Gap |
| --- | --- |
| §6 chart ranges, View Details / contract specs modal | Not tested; no stable hook on View Details |
| §5 / §7 Trades and Order History tabs | No testids (see §1) |
| §9 IOC, FOK, limit-cross | `PlaceOrderWidget` already supports TIF in `fill()`; no specs |
| §11 perps market round-trip + PnL | Only a resting bid on perps (`50-orders-by-venue`) |
| Leaderboard, mobile, WalletConnect UI, visual regression | Out of scope |

---

## 5. Local Hardhat target is documented, not exercised

**Where:** `.env.example` (`E2E_TARGET=local`)

`local` needs deployed addresses in `ui/.env`, optional subgraph, and has no
market maker for the other side of fills. Expect `00`, `10`, `20`, `60` to be
meaningful; order-match specs need a quoter the local stack does not provide.

---

## 6. Single shared wallet → one worker

**Where:** `e2e/playwright.config.ts` (`workers: 1`)

Funded specs share one nonce sequence and one account. Parallel workers would
race. Scaling later needs per-worker wallets plus vault top-up.

---

## 7. App issues the suite works around (not e2e bugs)

Recorded so failures are not chased in the wrong place:

- **`ReactGA.initialize is not a function` under Vite dev** —
  `ui/src/hooks/useAnalytics.ts` + CJS `react-ga4`. Production builds unwrap
  correctly. Suite attaches it under "known" in `console-errors.txt` instead of
  failing.
- **Deposit / withdraw amount fields shift Execute on blur** — validation adds
  or removes an error line; page objects blur before clicking Execute.
- **Market orders / Close all capped ~5% from mark** — a thin book can leave a
  market order partially unfilled; specs then fail on leftover size/position.
- **"Failed" after a successful receipt** — UI waits for the indexer; if the
  subgraph lags past the UI timeout, the step fails with that error text.

---

## 8. Missing hooks for the next easy specs

When adding scenarios, these are the first UI/e2e pieces still missing:

1. `tradesList` / `orderHistoryList` testids + `AccountTables` readers (§1).
2. Stable locator for View Details / `DetailedSpecsModal` (role/text may be
   enough; add a testid only if not).
3. Optional `SKIP.thinBook` / book preflight (§2).
4. Root or smoke-manual link to `e2e/` so new contributors find the suite.

Prefer roles, labels and visible text; add `data-testid` only when nothing
accessible holds — keep names in `ui/src/testids.ts` and import via
`e2e/src/testids.ts`.
