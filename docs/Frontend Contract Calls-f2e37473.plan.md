<!-- f2e37473-7101-45c0-9745-73e846800e6d -->
---
todos:
  - id: "sync-abis"
    content: "Synchronize UI ABIs with deployed Futures, Perps, PME, and options contracts"
    status: pending
  - id: "fix-correctness"
    content: "Show raw open orders individually and fix cancellation, simulation sender, collateral targets, and liquidation status"
    status: pending
  - id: "migrate-active-state"
    content: "Make indexed active state complete, block-aware, and safe for contract actions"
    status: pending
  - id: "typed-config"
    content: "Adopt reduce intents and direct venue configuration reads"
    status: pending
  - id: "cancel-all"
    content: "Add chunked Cancel All Orders flows for Futures and Perps"
    status: pending
  - id: "verify-ui"
    content: "Add regression tests and run typecheck, lint, and builds per commit"
    status: pending
isProject: false
---
# Frontend Contract Call Adoption

## Audit conclusion
- Keep the indexers as the primary source for active lists as well as history: indexed state is correct at its reported block and avoids `getUserOrders` → `getOrder` RPC fan-out.
- Expose raw contract `bytes32` order IDs alongside aggregate indexer entity IDs, fully paginate active records, and expose current position aggregates without reconstructing them from session metadata.
- Use on-chain reads for head-sensitive solvency/configuration values and transaction simulation. After writes, wait for the indexer to reach the receipt block; fall back to contract reads only when the indexer is unavailable or behind that required block.
- Do not replace [`usePortfolioSnapshot.ts`](/Users/shev/Dev/titan/futures-marketplace/ui/src/hooks/data/usePortfolioSnapshot.ts) with `computePortfolioMargins`: its per-expiry inputs are required to forecast margin at arbitrary prices. Pin both read waves to one common block instead.

## Implementation
1. **Synchronize ABIs with the deployed release**
   - Update Futures, Perps, and PME ABI pins in [`package.json`](/Users/shev/Dev/titan/futures-marketplace/ui/package.json) and regenerate the options UI ABIs.
   - Remove stale selectors and the handwritten Futures order-limit ABI only after confirming the configured Base Sepolia deployments expose the new methods.

2. **Fix transaction and risk correctness first**
   - Expose active Futures `OrderEntry` records with their raw contract `bytes32` IDs and remaining quantities; keep the parent aggregate only for history/fill metadata.
   - Stop grouping separate user orders by side, price, and expiration in [`OrdersListWidget.tsx`](/Users/shev/Dev/titan/futures-marketplace/ui/src/components/Widgets/Futures/OrdersListWidget.tsx). Render one row per raw contract order so FIFO priority, timestamp, fills, cancellation, and modification remain unambiguous.
   - Remove the global 100-row assumption: paginate raw active Futures orders across all deliveries so the UI remains complete under the per-expiration contract cap.
   - Rename “Close Order” to “Cancel Order” and call singular `cancelOrder(orderId)` through [`useCloseOrder.ts`](/Users/shev/Dev/titan/futures-marketplace/ui/src/hooks/data/useCloseOrder.ts). Do not create an opposite GTC order.
   - Modify or reduce only the selected raw order. Use `reduceOrderSize` when price is unchanged and quantity decreases; use `updateOrders([orderId], [], [replacement])` when cancel-and-replace is required.
   - Keep singular cancellation separate from the explicit “Cancel All Orders” action described below; batch cancellation must not be hidden behind a single-row action.
   - Pass the connected account to Perps/Futures `simulateOrder` reads so self-trade prevention matches execution.
   - In [`perps/options-ui/src/App.tsx`](/Users/shev/Dev/titan/perps/options-ui/src/App.tsx), route collateral deposits/withdrawals to `CollateralVault`, not `OptionMarginEngine`.
   - Use canonical PME/venue liquidation status for current health; suppress projected liquidation prices for accounts with options until the solver models price-dependent Greeks.

3. **Make indexed active state action-safe**
   - Futures: return complete raw active orders as distinct rows, and expose a current per-user/per-expiration position aggregate so the UI does not derive actionable state from historical sessions.
   - Perps: expose one current user position aggregate rather than summing `user.netQuantity` copied into multiple open sessions; retain sessions for dates, trades, realized PnL, and history.
   - Include indexed block numbers consistently in active-order and active-position responses. Post-write flows must wait for the receipt block before treating indexed state as current.
   - Keep simulation as the final authority before submission; use `getUserOrders`/`getOrder` and `getUserPosition` only as fallback reads when the indexer cannot satisfy the required block.

4. **Use typed order updates and direct configuration**
   - Extend [`useUpdatePerpsOrders.ts`](/Users/shev/Dev/titan/futures-marketplace/ui/src/hooks/data/perps/useUpdatePerpsOrders.ts) to send reduce intents when only quantity decreases at the same price, preserving FIFO.
   - Read tick size, maker/taker fees, and limits directly from each venue; retain the Perps indexer only for cumulative `totalVolume`.
   - Keep single-value `computePortfolioIM` reads where only IM is displayed; use `computePortfolioMargins` only where both IM and MM are consumed.

5. **Add Cancel All Orders for Futures and Perps**
   - Add an explicit confirmation modal alongside the existing position-close UX, showing the complete active-order count and warning that cancellation may require multiple transactions.
   - Source the full raw active-ID list from the paginated indexer response; never limit cancellation to visible table rows.
   - Submit deterministic chunks through each venue’s `updateOrders(chunkIds, [], [])`. Simulate every chunk before submission, wait for its receipt, and show batch/total progress.
   - Before the next chunk, refresh active IDs at the confirmed receipt block. If orders filled or were cancelled concurrently, rebuild the remaining list rather than submitting stale IDs.
   - Use bounded chunks for both products, with the chunk size validated by simulation/estimated gas and reduced when necessary. Do not attempt one unbounded atomic Futures transaction: the per-expiration cap allows substantially more orders than a safe single transaction.
   - On interruption or failure, report partial completion and leave the action resumable from the newly indexed active set.

6. **Keep order books indexed, with a canonical refresh path**
   - Continue normal polling through [`useAggregateOrderBook.ts`](/Users/shev/Dev/titan/futures-marketplace/ui/src/hooks/data/useAggregateOrderBook.ts) and [`usePerpsOrderBook.ts`](/Users/shev/Dev/titan/futures-marketplace/ui/src/hooks/data/perps/usePerpsOrderBook.ts).
   - Optionally refresh visible/top levels after confirmed writes using `getOrderBookPrices` plus batched `getQuantityAtPrice`, pinned to one block.
   - Do not replace the options order-book queue walk until the contract provides aggregate remaining quantity per level.

## Verification
- Add indexer and UI tests covering one row per raw contract order, no cross-order grouping, raw versus aggregate IDs, complete pagination beyond 100 Futures orders, singular cancellation, selected-order modification, chunked Cancel All in both modes, stale IDs between chunks, partial completion/resume, current-position aggregation without session double-counting, receipt-block synchronization, same-price reduce-in-place, account-aware simulation, and option-bearing liquidation display.
- Run indexer tests plus UI typecheck, lint, and build after each commit; deliver changes in small commits ordered as ABI sync, indexer schema/handler changes, correctness fixes, active-state consumption, and configuration cleanup.
