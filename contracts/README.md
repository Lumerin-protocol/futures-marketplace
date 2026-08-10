# Futures contracts

## Futures 4.3 order-index cutover

Futures 4.3 replaces the global per-participant order index with an index
bounded independently for each delivery date. Pause order writers, run the
normal `upgrade:futures`, then execute:

```sh
pnpm drop:active-orders --network <network>
```

The script discovers every participant from the indexer (with an event-scan
fallback) and calls `dropActiveOrders(users)` once. That owner-only operation
cancels legacy orders at currently tradable delivery dates while preserving
positions and expired historical orders. It estimates the complete transaction
and aborts if it cannot fit the configured/block gas limit; it never silently
splits the cutover.

Set `FUTURES_INDEXER_URL` (or `SUBGRAPH_URL`) for indexer discovery. Event
discovery requires `FUTURES_START_BLOCK` or `ETHERSCAN_API_KEY`;
`EVENT_SCAN_CHUNK_SIZE` defaults to `100000`.
`DRY_RUN=true` performs discovery and gas preflight without writing. Safe
operation uses `SAFE_OWNER_ADDRESS`, `PROPOSER_PRIVATEKEY`, and optionally
`SAFE_EXECUTION_GAS_OVERHEAD`.

## Gas benchmark

Run the deterministic HashPowerFutures ABI benchmark from this directory:

```sh
pnpm test:gas
```

It writes `benchmarks/futures-gas.json`. State-changing scenarios record gas from
transaction receipts; view and pure scenarios use viem gas estimates. The suite
also fails if a callable HashPowerFutures ABI function is missing a measurement of the
correct kind.

The benchmark helper and reusable GitHub Action are pinned to
`lsheva/evm-gas-benchmark@v1.0.2`.