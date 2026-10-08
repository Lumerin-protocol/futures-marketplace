# Futures contracts

## Bytecode budget

`HashPowerFutures` deploys to Base, so its runtime bytecode must stay under the
EIP-170 limit of 24 576 bytes. The compiler warns when it is exceeded. The 6.7.0
backstop work reclaimed space by removing the finished 4.3 order-index cutover
(`dropActiveOrders` and its script) and the no-op `setLiquidationMarginPercent`,
and by routing liquidation, settlement and force-close through `_applyFill`.
Check the size after any change to the venue:

```sh
node -e "const a=require('./artifacts/contracts/HashPowerFutures.sol/HashPowerFutures.json');console.log((a.deployedBytecode.length-2)/2)"
```

## Liquidation and the protocol backstop

`liquidatePosition(user, expirationAt)` / `liquidatePositions(user, expirationAts)`
close at the mark against the insurance fund as before, then hand the closed
signed quantity to the protocol backstop ledger (`BACKSTOP`, read from
`vault.BACKSTOP_ADDR()`) at the same price (`BackstopAssigned`). Matured legs are
refused (`PositionMatured`; the batch form skips them) and settle through
`settlePosition` instead. The backstop cannot be liquidated or traded as a user
(`BackstopAccount`).

`unwindBackstop(expirationAt, qty)` is permissionless: an IOC that only reduces
the backstop's leg, limited to `mark ± vault.backstopParams().unwindBandBps`,
reverting `TimeInForceNotFilled` on a zero fill, paying the caller
`unwindFeeBps` of the filled notional from the fee pot (`BackstopUnwound`). The
backstop pays no taker fee. `forceClosePositions(users, expirationAts)` is an
owner-only, halted-only close at the mark with no hand-off, for clearing
residual exposure. Design and operations:
`collateral-margin/docs/protocol-liquidation-exposure.md`.

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