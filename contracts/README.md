# Futures contracts

## Futures 4.1 order-cache migration

The 4.1 upgrade rebuilds the per-user, per-expiration order aggregate in the
same `upgradeToAndCall` transaction. There is no lazy fallback or supported
post-upgrade migration window.

1. Pause every order writer (UI, market maker, keeper) and leave removal and
   liquidation automation paused. Set `FUTURES_ORDER_FLOW_PAUSED=true`.
2. Configure discovery. `ORDER_CACHE_DISCOVERY_SOURCE=auto` uses
   `FUTURES_INDEXER_URL` (or `SUBGRAPH_URL`) and falls back to events.
   `indexer` pins and paginates one snapshot, rejects indexing errors/excess
   lag, and scans the lagging event tail. `events` scans `OrderCreated` from
   `FUTURES_START_BLOCK`; without that value it resolves the deployment block
   through Etherscan.
3. Run `pnpm upgrade:futures --network <network>`. The script filters candidates
   only by nonempty on-chain `getUserOrders` (expired-but-not-removed orders are
   included), simulates and estimates the atomic upgrade/rebuild, then aborts
   before the upgrade or Safe proposal if it cannot fit.
4. Direct-owner execution verifies every expiration against an independent
   `getUserOrders`/`getOrder` scan at the upgrade block. For a Safe, execute the
   proposed atomic transaction and run
   `VERIFY_ONLY=true pnpm rebuild:order-cache --network <network>`.
5. Resume order flow only after verification succeeds.

Common variables are `FUTURES_ADDRESS`, `VAULT_ADDRESS`,
`ORDER_CACHE_DISCOVERY_SOURCE`, `FUTURES_INDEXER_URL`, `FUTURES_START_BLOCK`,
`EVENT_SCAN_CHUNK_SIZE` (default `5000`), `MAX_INDEXER_LAG_BLOCKS` (default
`50`), `READ_CONCURRENCY` (default `25`), and `ETHERSCAN_API_KEY`.
`FUTURES_ORDER_CACHE_USERS` may instead provide a comma-separated, complete
participant list; setting it is an assertion that no order owner is omitted.
Safe operation additionally uses `SAFE_OWNER_ADDRESS`, `PROPOSER_PRIVATEKEY`,
and optionally `SAFE_API_KEY`. `MAX_ATOMIC_UPGRADE_GAS` can set a stricter cap
than the block gas limit and `SAFE_EXECUTION_GAS_OVERHEAD` defaults to `150000`.

For a standalone repair after 4.1, run `pnpm rebuild:order-cache --network
<network>`. `ORDER_CACHE_WRITE_BATCH_SIZE` controls transaction/proposal size
(default `50`), `DRY_RUN=true` prints the discovered physical-order owners
without writing, and `VERIFY_ONLY=true` performs only the independent
verification. Direct owners rebuild each batch and verify afterward; Safe mode
proposes each batch and must be followed by `VERIFY_ONLY=true` after execution.

## Gas benchmark

Run the deterministic Futures ABI benchmark from this directory:

```sh
pnpm test:gas
```

It writes `benchmarks/futures-gas.json`. State-changing scenarios record gas from
transaction receipts; view and pure scenarios use viem gas estimates. The suite
also fails if a callable Futures ABI function is missing a measurement of the
correct kind.

The benchmark helper and reusable GitHub Action are pinned to
`lsheva/evm-gas-benchmark@v1.0.2`.