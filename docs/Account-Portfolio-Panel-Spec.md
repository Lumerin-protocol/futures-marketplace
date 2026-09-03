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
| **Margin Ratio** | `MM / Balance × 100`, clamp display at 999% | derived |

Colours: Unrealized PnL green / red / neutral as today. Equity and Margin Used
neutral. Available neutral; grey when 0.

## Tooltips

- **Equity**: "Balance plus unrealized PnL across all venues."
- **Margin Used**: "Initial margin held for open positions and resting orders."
- **Available**: "Withdrawable and usable for new positions. Unrealized gains
  are not available until realized."
- **Margin Ratio**: "Maintenance margin ÷ balance. Positions are liquidated at
  100%."

## Alerts

Single driver: `ratio = MM / Balance`. `belowIM = Balance < IM` is a separate
capability flag, not a risk level.

| State | Condition | Panel | Status line copy |
|---|---|---|---|
| Healthy | ratio < 60% and !belowIM | none | none |
| Restricted | belowIM (any ratio) | Withdraw max = 0, note under Available | "Below initial margin. Withdrawals and new positions are disabled; reducing orders are allowed." |
| Caution | 60% ≤ ratio < 80% | amber left border + radial (current `shouldHighlight` styling) | "Margin ratio 72%. Liquidation at 100%." |
| Danger | 80% ≤ ratio < 100% | red border, one toast on entry, persistent banner | "Liquidation risk. Deposit or reduce your position. Liq. price ≈ {liqPrice}." (`useLiquidationThresholds`) |
| Liquidatable | ratio ≥ 100% | red pulsing banner | "Account is liquidatable. Positions may be closed at any moment." |

Restricted stacks with Caution / Danger.

Remove the current `IM / Balance ≥ 80%` "Low Margin: Add Funds to Avoid
Liquidation" check (`FuturesBalanceWidget.tsx`, `shouldHighlight`). It fires
while the account is nowhere near liquidation.

### Mechanics

- Hysteresis 5 points: enter Caution at 60, exit at 55; enter Danger at 80,
  exit at 75.
- One toast per tier entry per session; banner persists until the tier clears.
- Thresholds from env: `REACT_APP_MARGIN_RATIO_CAUTION_PERCENT=60`,
  `REACT_APP_MARGIN_RATIO_DANGER_PERCENT=80` (replace
  `REACT_APP_MARGIN_UTILIZATION_WARNING_PERCENT`).
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
- MM ≈ 195.71 / 2 + 24.02 = 121.88 → Margin Ratio ≈ 61%

State: Restricted + Caution. Not liquidatable. Old UI showed
"Low Margin: Add Funds to Avoid Liquidation", which overstated the risk.

## Out of scope

Telegram bot in `notifications/` should mirror Danger and Liquidatable only,
same hysteresis, 1 h re-notify cap. Separate ticket.
