# Futures contracts

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