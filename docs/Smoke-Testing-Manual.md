# HashPower Derivatives Exchange — Smoke Test Manual

Audience: QA, product, management (no developer setup).  
Goal: confirm the main trading path works end-to-end on the **dev** UI (Base Sepolia).

**Dev assumption:** a market maker is already quoting both Futures and Perpetuals. You only need **one wallet**. Matching means trading into the live order book (MM bids/asks), not placing opposite orders from a second wallet.

If the book looks empty on both sides for several minutes, stop and ask the team to check that the maker is running — do not try to “be the maker” yourself unless asked.

### Import into Testomat.io

Spreadsheet exports of this suite (Testomat custom format):

- [`Smoke-Testing-Manual.testomat.xlsx`](./Smoke-Testing-Manual.testomat.xlsx)
- [`Smoke-Testing-Manual.testomat.csv`](./Smoke-Testing-Manual.testomat.csv)

In Testomat.io:

1. Open the project → **Imports** (or **Import from Spreadsheet** on an empty Tests page).
2. Choose **Import from CSV**.
3. Format: **Testomatio**.
4. Upload the `.xlsx` or `.csv` file → **Create**.

### Shared Google Doc (all steps + per-step results tables)

Full procedure with a **Team results** table after every step (example row included):

- [`HPDX-Smoke-Testing-Google-Doc.docx`](./HPDX-Smoke-Testing-Google-Doc.docx) — upload to Google Drive → **Open with Google Docs** → Share (Editors)
- [`HPDX-Smoke-Testing-Google-Doc.md`](./HPDX-Smoke-Testing-Google-Doc.md) — same content in markdown

---

## Prerequisites

Complete these before the smoke run. Without them you will fail at connect, deposit, or fill steps.

| Prerequisite | Details |
| --- | --- |
| Dev UI URL | Get the current HashPower Derivatives Exchange **dev** link from the team if you do not already have it |
| Wallet (pick at least one path) | **A.** Browser extension wallet (e.g. MetaMask, Rabby) **or** **B.** Mobile wallet that supports WalletConnect (e.g. MetaMask mobile, Rainbow) |
| Network | **Base Sepolia** added in the wallet and selected |
| Gas | Small amount of **Base Sepolia ETH** for transaction fees |
| Test USDC | Collateral token used to deposit and trade on dev |
| Access | Ability to connect the wallet to the UI and sign / confirm transactions |
| Time | ~20–30 minutes for one wallet path; ~40–50 minutes if you run **both** A and B |

### Where to get test tokens

Dev USDC (and Base Sepolia ETH if you need gas) are **not** self-serve from a public faucet for this environment.

1. Open Slack.
2. Message **@shev** with:
   - your wallet address
   - that you need **dev / Base Sepolia** test tokens for HPDX smoke testing
   - roughly how much you need (e.g. 50–100 USDC + a little ETH for gas is enough)
3. Wait until the tokens show in your wallet on **Base Sepolia**, then continue.

---

## Before you start

| Need | What “good” looks like |
| --- | --- |
| URL | Dev UI loads without blank screen |
| Network | Wallet shows **Base Sepolia** (or the network named in the top-right) |
| Token | Wallet has **test USDC** (from @shev) and a little Base Sepolia ETH for gas |
| Wallet | Connect works for your chosen path (browser injected and/or WalletConnect); address shows |
| Liquidity | Order book shows both bids (green) and asks (red) around the mid price |
| Time | Budget ~20–30 minutes for full pass |

**Pass rule for each step:** UI updates as described, wallet tx succeeds, no stuck spinner, and numbers look consistent (balance, orders, positions, PnL).

**Fail rule:** tx reverts, page errors, wrong tab count, balance not updating after refresh, empty book with no MM, or PnL clearly nonsense vs entry/mark.

---

## 1. First look (page health + maker liquidity)

1. Open the app. Confirm title **HashPower Derivatives Exchange**.
2. Confirm tabs: **Futures** / **Perpetuals**.
3. Confirm ticker: Hash Price, Funding Rate, Total Volume, **View Details**.
4. Confirm the **price chart** loads (Hashprice / USDC; 1D / 7D / 30D).
5. Confirm order book shows **both** bids and asks and a mid price (this is the maker).
6. Confirm right panel: Account Portfolio + order ticket (Limit/Market, Bid/Ask).
7. Confirm bottom tabs: Open Orders, Positions, Trades, Position History, Order History.
8. Open **Leaderboard** (trophy), then **Back** to trading.
9. Switch to **Perpetuals** briefly and confirm that book also has two-sided quotes, then return to **Futures**.

**Pass:** All areas render; Futures and Perps both show live two-sided books.

**Blocker:** One-sided or empty book → maker likely down; escalate before continuing fill tests.

---

## 2. Connect wallet

Run **Option A**, **Option B**, or both. If you only have time for one full trade path, still try both connects (connect → see address → disconnect) before continuing with one wallet for deposit/trade.

### Option A — Injected browser wallet

Use a wallet extension in the same browser as the UI (e.g. MetaMask, Rabby).

1. Unlock the browser wallet and select **Base Sepolia**.
2. On the UI, click connect (top right).
3. In the connect modal, choose the **browser / injected** wallet (often shown as MetaMask, Rabby, or “Browser Wallet”).
4. Approve the connection in the extension popup.
5. Confirm the UI shows your address and **Base Sepolia**.
6. Disconnect from the UI, then connect again the same way.

**Pass:** Address stays visible; Account Portfolio loads (values or zeros); no infinite spinner.

**Fail:** Modal offers no injected option, popup never appears, wrong network stuck, or connect loops.

### Option B — WalletConnect with mobile wallet

Use the desktop (or laptop) UI and a **mobile** wallet via QR / WalletConnect.

1. On the phone, unlock the mobile wallet and ensure **Base Sepolia** is available.
2. On the UI, click connect (top right).
3. In the connect modal, choose **WalletConnect**.
4. A QR code appears on the desktop. Scan it with the mobile wallet (or use the wallet’s “WalletConnect” / Scan feature).
5. Approve the connection on the phone.
6. Confirm the UI shows your mobile wallet address and **Base Sepolia**.
7. Keep the phone unlocked / wallet app open when you later sign permit, deposit, and orders — prompts appear on the **phone**.
8. Disconnect from the UI, then reconnect via WalletConnect once more.

**Pass:** Address stays visible; signing prompts reliably reach the phone; Account Portfolio loads.

**Fail:** QR never loads, scan connects then drops, prompts never arrive on mobile, or session dies mid-flow.

### After connect

Continue steps 3–13 with the wallet path you will use for trading. If testing **both** paths end-to-end, finish deposit → one small Futures Market Bid → Close → Withdraw once per path (or at least connect + one signed action each).

---

## 3. Deposit funds

Shared collateral: one deposit funds **both** Futures and Perps.

1. Note starting **Balance**.
2. Click **Deposit**.
3. Enter a small amount (e.g. `10` USDC). Try **Max** once.
4. Complete the **permit** flow: sign the permit, then deposit. Confirm each wallet prompt.
5. After success, Balance increases by ~that amount.
6. Hard-refresh the page; Balance should still match.

   | Browser | Hard refresh |
   | --- | --- |
   | Chrome / Edge (Windows/Linux) | `Ctrl` + `Shift` + `R`, or `Ctrl` + `F5` |
   | Chrome / Edge (Mac) | `Cmd` + `Shift` + `R` |
   | Firefox (Windows/Linux) | `Ctrl` + `Shift` + `R`, or `Ctrl` + `F5` |
   | Firefox (Mac) | `Cmd` + `Shift` + `R` |
   | Safari (Mac) | `Cmd` + `Option` + `R` |

Optional: Deposit a tiny amount again to confirm second deposit works.

**Pass:** Balance up; no double-count after refresh.  
**Record:** start balance, deposit amount, end balance.

---

## 4. Futures — resting limit order (no fill)

Use this to prove resting orders work **without** hitting the maker. Place a **buy (Bid)** below the book so it rests.

1. Stay on **Futures**.
2. Pick a delivery/expiration if the UI offers one (away from immediate expiry).
3. Order type **Limit**, TIF **GTC**.
4. Note the **lowest visible bid** in the order book. Set **Price** a few ticks **below** that (clearly under the maker’s bids).
5. Size small (e.g. `1`–`5`).
6. Note **Required Margin** / Quantity footer before submit.
7. Click **Bid**. Confirm wallet tx.
8. Bottom → **Open Orders**: count goes from 0 → 1; row shows a buy at your price/size.
9. Order book should show your bid at that price (below the maker levels).
10. Account: **Locked** may rise; Balance should not drop below locked needs.

**Pass:** Buy order rests; Open Orders badge matches the row.  
**Then cancel it** (or leave it and cancel in step 8) so it does not confuse later fill checks.

---

## 5. Matching against the market maker (Futures)

You are the **taker**. Buy into the maker’s asks to open a **long**.

1. In the order book, find the **best ask**: the **lowest red sell price** (the ask row closest to the mid price, just above the green bids). Note that price and the **Size** on that row.
2. Order type **Market**, TIF can stay at default.
3. Set **Size** small and **below** the best-ask size (e.g. `1` if the top ask is larger).
4. Click **Bid**. Confirm the wallet tx.
5. Expect an immediate fill.

### After the fill

| Check | Expected |
| --- | --- |
| Open Orders | No leftover from this market buy |
| Positions | One **Long** / Open position |
| Trades | New trade row(s); taker fee may be > 0 |
| Order book | Top ask reduced or refreshed (maker may requote quickly) |
| Unrealized PnL | Populated (can be near zero right after fill) |
| Chart | May show an **Entry** line |

**Pass:** Fill appears in **Trades**; **Positions** shows a long.

**Fail / escalate:** Tx succeeds but no position/trade → screenshot the book and ping the team.

---

## 6. Positions & PnL checks

With an open position:

1. **Positions** tab: Side, Status Open, Entry, Size, Net Quantity, Fees, Unrealized / Realized PnL, Liquidation Price.
2. Account Portfolio **Unrealized PNL** should match the position row (same sign/color).
3. Change the price chart to 1D / 7D / 30D — page stays usable; Entry line still sensible if shown.
4. Open **View Details** / contract specs — modal opens and closes cleanly.
5. Wait or refresh: Unrealized PnL should move when hash price moves (as a long, it rises when price rises).

**Pass:** Portfolio PnL and position PnL agree; no “—” stuck after data should load.

---

## 7. Exit / close position (against the maker)

1. On the long position row, click **Close**.
2. Confirm full size in the close flow; submit the wallet tx.
3. This sells into the maker’s bids and should flatten the long.
4. After success:
   - Position closed or reduced
   - **Trades** shows the closing fill
   - Unrealized → ~0 for that size
   - Realized PnL updates (row and/or **Realized PNL (30D)**)
5. Open **Position History** — closed session appears.
6. Open **Order History** — related orders appear.

**Pass:** Flat (or reduced) exposure; histories populated; no orphan Open Orders from the close.

---

## 8. Cancel resting order (no fill path)

1. Place another away-from-market GTC limit (outside the maker spread).
2. Cancel from **Open Orders**.
3. Confirm: order removed, Locked drops if that was the only lock, book updates.

**Pass:** Cancel confirmed; counts return to previous state.

---

## 9. Order types / TIF smoke (Futures)

Keep sizes tiny relative to top-of-book.

| Case | Steps | Expected |
| --- | --- | --- |
| Market | Market Bid or Ask into maker book | Immediate fill; position/trades update |
| Limit cross | Limit at/through best opposite price | Fills like a taker against maker |
| IOC | Limit crossing with size larger than visible top | Partial fill possible; remainder **not** resting |
| FOK | Size larger than available liquidity at your price | Tx fails or UI blocks; **no** partial rest |
| Non-crossing GTC | Limit outside spread | Rests (step 4 / 8); no fill until someone hits it |
| Zero size | Size `0` if UI allows | Blocked in UI |

**Pass:** Behavior matches the table; errors are understandable.

---

## 10. Withdraw

1. Prefer flat: no open orders/positions (or only withdraw “free” collateral).
2. Note Balance.
3. **Withdraw** a small amount.
4. Confirm wallet txs; Balance down; wallet USDC up.
5. Try withdraw more than available — should fail gracefully.

**Pass:** Withdraw works when free margin allows; over-withdraw blocked.

---

## 11. Perpetuals tab

Same idea: trade against the **Perps** maker book with one wallet.

1. Switch to **Perpetuals** — confirm two-sided book; note leverage (e.g. **10x**) / funding.
2. Place a small **Limit Bid** below the lowest visible bid → appears in Open Orders → cancel.
3. **Market** + **Bid**, size below the best ask → open a long against the maker.
4. Check Positions (Long), Unrealized PnL, Trades.
5. Click **Close** on the long to sell into the maker.
6. Switch back to Futures and confirm lists do not mix the other product’s live rows.

**Pass:** Perps open → PnL → close works against the maker; mode switch stays clean.

---

## 12. Leaderboard & points

1. After some fills, open **Leaderboard**.
2. Confirm rankings load (maker wallet may be hidden from the list — that is OK).
3. If connected, your points / recent mints section loads or shows empty state cleanly.
4. Back to trading via **Back** or logo.

**Pass:** Page usable; no crash; points update after trades within a reasonable delay (indexer lag OK — note if > a few minutes).

---

## 13. Mobile / resize (optional but useful)

1. Narrow the browser or use a phone.
2. Connect, open Deposit, place a tiny order into the maker, open Positions.

**Pass:** Primary actions reachable; no unusable overlap.

---

## Suggested happy-path script (minimal)

One wallet, maker already live:

1. Connect on Base Sepolia (Option A browser wallet and/or Option B WalletConnect mobile)  
2. Confirm Futures **and** Perps books are two-sided  
3. Deposit 10 USDC (sign permit on extension or phone)  
4. Futures: Limit Bid below lowest bid → Open Orders → cancel  
5. Futures: Market Bid into best ask → Long in Positions + Trades  
6. Check Unrealized PnL matches position row  
7. Close the long → histories update  
8. Withdraw 1 USDC  
9. Perps: Market Bid long, then Close  
10. Open Leaderboard once  

---

## Results sheet (copy for testers)

| # | Area | Result (Pass/Fail) | Notes / tx link |
| --- | --- | --- | --- |
| 1 | Page load / tabs / two-sided books | | |
| 2a | Connect — injected browser wallet | | |
| 2b | Connect — WalletConnect mobile | | |
| 3 | Deposit | | |
| 4 | Resting Limit Bid (below book) | | |
| 5 | Market Bid fill → Long | | |
| 6 | Positions & PnL | | |
| 7 | Close long vs maker | | |
| 8 | Cancel order | | |
| 9 | Market / IOC / FOK | | |
| 10 | Withdraw | | |
| 11 | Perpetuals smoke vs maker | | |
| 12 | Leaderboard | | |
| 13 | Mobile (optional) | | |

**Environment:** dev (Base Sepolia)  
**Build / date:** _______________  
**Tester:** _______________  
**Maker books OK at start?** Yes / No  

---

## What “healthy” looks like on dev

- Connected wallet + Base Sepolia visible  
- Futures and Perps order books both two-sided (maker online)  
- Account Balance / Locked / Unrealized / Realized populated after activity  
- After a fill: open position with Entry, Size, Unrealized PnL  
- Bottom tab badges match table contents  
- Closing works by hitting the opposite maker quotes  
