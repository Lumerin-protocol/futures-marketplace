# @hashpower/futures-abi

ABIs and deployment addresses for the Hashpower hashprice futures marketplace on Base.

`HashPowerFutures` is an on-chain order book for dated hashprice futures with physical/cash delivery:

| Action | Function |
| --- | --- |
| Place an order | `createOrder(price, deliveryDate, destURL, qty)` — signed qty: + buy, − sell |
| Batch place | `createOrders(OrderIntent[])` |
| Cancel a resting order | `closeOrder(orderId)` |
| Read the book | `getBidPrices`, `getAskPrices`, `getQuantityAtPrice`, `getMarketPrice` |
| Margin / PnL | `getFuturesOrderMargin`, `getFuturesUnrealizedPnl`, `isLiquidatable` |
| Delivery | `depositDeliveryPayment`, `withdrawDeliveryPayment`, `closeDelivery` |

Collateral flows through the shared `CollateralVault` (see `@hashpower/collateral-abi`) — deposit USDC there before trading.

## Usage

```ts
import { HashPowerFuturesAbi } from "@hashpower/futures-abi";
import deployments from "@hashpower/futures-abi/deployments.json" with { type: "json" };

// "testnet" (Base Sepolia) or "mainnet" (Base)
const env = process.env.HASHPOWER_ENV ?? "testnet";
const { contracts, subgraphs } = deployments.environments[env];

const marketPrice = await client.readContract({
  address: contracts.HashPowerFutures,
  abi: HashPowerFuturesAbi,
  functionName: "getMarketPrice",
});
```

Order books, positions, fills, and liquidations are indexed by the futures subgraph (`subgraphs.futures` in `deployments.json`).

Raw JSON ABIs (for subgraphs and non-TypeScript consumers) are available under `@hashpower/futures-abi/json/<Contract>.json`.

## How this package is built

Contents are generated — do not edit by hand:

- `src/` is copied from `../contracts/abi` (the Hardhat codegen output, mocks excluded) by `scripts/build.mjs`, then compiled to `dist/`.
- `deployments.json` is the canonical address manifest for this repo; it is updated when contracts are (re)deployed.

Publishing happens automatically from CI when ABIs or the manifest change (see `.github/workflows/publish-futures-abi.yml`).
