# Futures contracts

## Futures 4.1 order-cache migration

`upgrade:futures` only upgrades the implementation. After upgrading from a
version before 4.1, immediately run:

```sh
pnpm rebuild:order-aggregate-cache --network <network>
```

This is a deliberately non-atomic migration: existing orders have zero
aggregate cache until the rebuild transactions complete.

The rebuild script discovers order owners from `OrderCreated` RPC logs over the
preceding 180 days and confirms candidates through nonempty on-chain
`getUserOrders`; expired-but-not-removed orders remain included. Set
`EVENT_LOOKBACK_DAYS` to change the search period. `EVENT_SCAN_CHUNK_SIZE`
defaults to `100000`, `READ_CONCURRENCY` defaults to `25`, and
`ORDER_CACHE_WRITE_BATCH_SIZE` defaults to `50`.

`DRY_RUN=true` prints the discovered owners without writing, while
`VERIFY_ONLY=true` only verifies the cache. Safe operation additionally uses
`SAFE_OWNER_ADDRESS`, `PROPOSER_PRIVATEKEY`, and optionally `SAFE_API_KEY`.

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