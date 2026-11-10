# Liquidation fee comparison

## What others charge (looked up Oct 6, 2026)

| Venue | Liquidation fee | Where it goes |
|---|---|---|
| Binance | 1.25% of notional on BTC/ETH; 1.5–2% on thinner contracts (2% on XMR) | Insurance fund; not charged if the account is bankrupt |
| Bybit | No explicit fee, but the position is closed at the bankruptcy price, so the trader loses all remaining margin | Insurance fund |
| OKX | Taker fee (0.05%) plus a charge equal to the maintenance margin of the reduced position | Covers the liquidation's slippage; the rest goes to the insurance fund |
| BitMEX (shut down Sep 2026) | Kept the whole maintenance margin | Insurance fund |
| dYdX v4 | Up to 1.5% | Insurance fund |
| Hyperliquid | None when the order book absorbs it; in a backstop takeover the whole maintenance margin is kept (1.25–16.7%) | Its community liquidity vault |
| GMX v2 | 0.20–0.45% of position size | Liquidity pool and fee receiver |

## Our options

Assumes a 20% liquidator share. The backstop costs 55 bps in the worst case and 12–17 bps typically.

| Fee | Venue keeps | Liquidator gets | Net, worst case | Net, typical | Share of the 5% cushion |
|---|---|---|---|---|---|
| 100 bps | 80 | 20 | +25 | about +65 | 20% |
| 150 bps | 120 | 30 | +65 | about +105 | 30% |
| 200 bps | 160 | 40 | +105 | about +145 | 40% |

## What limits going higher

- **The fee has to stay well below the 5% maintenance margin.** Closing one unit at the mark frees 5% of margin but also costs the fee, so each unit closed only improves the account by 5% minus the fee.
- **At 2%, the keeper has to close about 67% more** than it would with no fee.
- **At 5%, a partial liquidation could never restore an account.**
- **The keeper ignores the fee when sizing partial liquidations,** so higher fees mean more rounds.
