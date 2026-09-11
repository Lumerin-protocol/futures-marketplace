# Account Portfolio Panel — Spec

Replaces the current `Balance / Unrealized PnL / Locked / Realized PnL` grid in
`ui/src/components/Widgets/Futures/FuturesBalanceWidget.tsx`.

## Background

"Locked" today is `computePortfolioIM(user)`. That figure already includes the
account's unrealized loss (`pnlTerm` in `PortfolioMarginEngine`), so showing it
next to Unrealized PnL double-counts the loss and makes
`Balance + uPnL < Locked` look like an accounting error. It is not: IM is a
requirement recomputed live, not a slice of balance set aside. The redesign
splits the loss back out so the numbers on the panel add up, and drives the
warning off maintenance margin (the actual liquidation threshold) instead of
initial margin.

## Layout

```
ACCOUNT PORTFOLIO (USDC)

Equity            175.98      Unrealized PnL      -24.02
Margin Used       195.71      Available             0.00
                              Realized PnL (30D)    0.00

[ Deposit ]  [ Withdraw ]

Margin Ratio  61%  ████████░░░░   liquidation at 100%
<status line, see Alerts>
```

## Definitions

All on-chain reads go through the margin engine resolved from
`HashPowerFutures.portfolioMargin()`. `computePortfolioMargins(user)` returns
`(IM, MM)` in one call. Poll at the existing 5–15 s cadence with
`keepPreviousData`.

| Field | Formula | Source |
|---|---|---|
| Balance (not displayed) | `vault.balanceOf(user)` | existing `useGetFutureBalance` |
| uPnL (on-chain) | `Σ getRiskView(user).unrealizedPnl` over `engine.getLinearMarkets()` | already fetched in `usePortfolioSnapshot` |
| Unrealized loss term | `Σ max(0, −getRiskView(user).unrealizedPnl)` per market (clamped per market, not netted) | same reads |
| **Equity** | `Balance + uPnL (on-chain)` | derived |
| **Margin Used** | `IM − unrealized loss term` | derived |
| **Available** | `max(0, Balance − IM)` | derived; this is exactly the vault's withdrawal check |
| **Unrealized PnL** | keep current `usePortfolioUnrealizedPnl` (subgraph + mark), tooltip "Across all venues" | existing |
| **Realized PnL (30D)** | unchanged | existing |
| **Margin Ratio** | `stress_MM / (Balance − shared) × 100` — see Alerts; clamp display at 999% | derived from IM, MM and the engine's spot shocks |

Colours: Unrealized PnL green / red / neutral as today. Equity and Margin Used
neutral. Available neutral; grey when 0.

## Tooltips

- **Equity**: "Balance plus unrealized PnL across all venues."
- **Margin Used**: "Initial margin held for open positions and resting orders."
- **Available**: "Withdrawable and usable for new positions. Unrealized gains
  are not available until realized."
- **Margin Ratio**: "Maintenance stress ÷ equity, with unrealized losses
  counted and gains ignored as the margin engine does. Amber begins where
  balance meets initial margin; positions are liquidated at 100%."

## Alerts

Single driver: the margin ratio. `belowIM = Balance < IM` is a separate
capability flag, not a risk level.

### The ratio

The engine (`_computeMargin`, mirrored by `@hashpower/portfolio-margin`) builds
both requirements the same way: `IM = stress(S) + shared`,
`MM = stress(s) + shared`, where `shared` is fill loss + unrealized loss +
funding owed and `S`/`s` are the IM/MM spot shocks. Its two checks,
`Balance ≥ IM` and `Balance ≥ MM`, are therefore
`Balance − shared ≥ stress(S)` and `≥ stress(s)`: equity (losses counted,
gains ignored) against a pure stress figure.

The panel shows the second check as a fraction
(`lib/marginRisk.marginRatioPercent`):

```
stress_s = (IM − MM) · s / (S − s)        (a linear book's stress scales with the shock)
ratio    = stress_s / (Balance − MM + stress_s)
```

Raw `MM / Balance` reaches 100% at liquidation too, but where it sits at the IM
boundary depends on how much loss is in MM (67% with a loss equal to the MM
stress). Stress-over-equity pins both ends for every account: **50% exactly
where Balance meets IM, 100% exactly where it meets MM** (at the shipped
shocks). That is what lets the tiers be constants of the deployment.

### Tiers

Boundaries follow the shocks (`lib/marginRisk.thresholdsFromShocks`):

- Caution begins where balance meets IM, `r = s / S` — the same point at which
  the vault starts refusing withdrawals and new positions.
- Danger begins where half of the IM-to-MM cushion is gone,
  `Balance = (IM + MM) / 2`, i.e. `r = 2s / (S + s)`.

At the shipped shocks (IM 10%, MM 5%) that is Caution at 50% and Danger at 67%,
for every account regardless of its losses; the figures below use those.

| State | Condition | Panel | Status line copy |
|---|---|---|---|
| Healthy | ratio < 50% (⇔ Balance ≥ IM) | none | none |
| Restricted | belowIM (any ratio) | Withdraw max = 0, amber boxed note | "Below initial margin. Withdrawals and new positions are disabled; reducing orders are allowed." |
| Caution | 50% ≤ ratio < 67% | amber left border + radial (current `shouldHighlight` styling) | "Margin ratio 58%. Liquidation at 100%." — only if not Restricted |
| Danger | 67% ≤ ratio < 100% | red border, one toast on entry, persistent banner | "Liquidation risk. Deposit or reduce your position. Liq. price ≈ {liqPrice}." (`useLiquidationThresholds`) |
| Liquidatable | ratio ≥ 100% | red pulsing banner | "Account is liquidatable. Positions may be closed at any moment." |

One note at a time. Caution begins exactly where balance drops below IM, so
Restricted and Caution would always appear together; the Restricted copy is
shown because it says what the user can no longer do, while the ratio is already
on the gauge. The Caution line only appears on the rounding edge where the tier
and the flag disagree. Danger / Liquidatable replace both. The amber border and
radial still follow the tier.

Remove the current `IM / Balance ≥ 80%` "Low Margin: Add Funds to Avoid
Liquidation" check (`FuturesBalanceWidget.tsx`, `shouldHighlight`). It fires
while the account is nowhere near liquidation.

### Mechanics

- No hysteresis: the tier is a pure function of the current ratio. Each
  boundary is an engine fact (below IM, half-way to MM, liquidatable), so the
  colour clears the moment it stops being true — Caution and Restricted always
  agree.
- One toast per tier per session; banner persists until the tier clears.
- No threshold env vars: the boundaries follow the on-chain requirements, so a
  parameter change cannot leave the colours wrong.
- If the margin read errors, render "—" for Margin Used, Available and Margin
  Ratio, and no green state. Do not imply healthy.

## Edge cases

- Balance = 0: Margin Ratio shows "—", no alert tiers.
- No open exposure (IM = 0): Margin Used 0.00, Available = Balance, ratio 0%.
- Cross-venue mixed PnL (e.g. futures −30, perps +10): IM clamps losses per
  market, so `Equity − Margin Used ≠ Available` by design. Available is
  authoritative; no reconciliation needed.
- Account in profit: `Equity − Margin Used > Available` because IM ignores
  unrealized gains. The Available tooltip covers this.
- Equity (on-chain uPnL) and the Unrealized PnL cell (subgraph) can differ by
  cents while the indexer catches up. Acceptable.

## Worked example (the screenshot that prompted this)

On-chain: Balance 200.00, IM 219.73, uPnL −24.02, shocks IM 10% / MM 5%.

- Unrealized loss term = 24.02
- Margin Used = 219.73 − 24.02 = 195.71
- Equity = 200.00 − 24.02 = 175.98
- Available = max(0, 200.00 − 219.73) = 0.00
- MM ≈ 195.71 / 2 + 24.02 = 121.88
- MM stress = IM − MM = 97.85; equity for margin = 200.00 − 121.88 + 97.85 =
  175.97 → Margin Ratio ≈ 56% (raw MM / Balance would say 61%)

State: Caution tier with the Restricted note (just past the 50% IM boundary,
consistent with Available = 0). Not liquidatable. Old UI showed
"Low Margin: Add Funds to Avoid Liquidation", which overstated the risk.

## Out of scope

Telegram bot in `notifications/` should mirror Danger and Liquidatable only,
same thresholds, 1 h re-notify cap. Separate ticket.
