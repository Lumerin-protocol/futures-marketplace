# Futures Indexer

A Graph Protocol subgraph that indexes the `HashPowerFutures` contract, turning on-chain events into a queryable GraphQL API for orders, trades, positions, expirations, and liquidation data.

> Collateral balances and deposit/withdrawal history are not tracked here — those live on the shared `CollateralVault` and are indexed by the collateral-margin subgraph.

> **Cash settlement (contract `2.15.0`).** Futures are cash-settled at maturity. Settlement surfaces as `PositionSettled`, emitted by the permissionless `settlePosition`, against the price pinned by `SettlementPriceRecorded`.

The schema is deliberately kept in step with the [perps indexer](../../perps/indexer/README.md): `Order`, `Trade`, `Fill`, and `PositionSession` mean the same thing on both venues and carry the same field names. The differences are product differences — futures have expiration dates and cash settlement, perps have funding and a reserve pool. One notable scaling difference: futures contracts are indivisible, so `quantityDecimals` is 0 and `totalVolume` carries no divisor, whereas perps positions are divisible at 6 decimals.

## Schema

### Entities

| Entity | Mutability | Description |
| --- | --- | --- |
| **Futures** | mutable | Singleton (id=0). Contract config, addresses (`priceOracle`, `portfolioMargin`, `collateralVault`), and global stats (total users/orders/trades/fills/volume/liquidations). |
| **User** | mutable | Per-address account: order/trade/fill counts, realized PnL, and relations to all other entities. Net position is per-expiration, so it lives on `UserDeliverySessionPointer` rather than here. |
| **Order** | mutable | An order on the book for one expiration date. Tracks price, quantity, buy/sell side, status (`ACTIVE` / `PARTIALLY_FILLED` / `FILLED` / `CANCELLED` / `LIQUIDATED` / `EXPIRED`), and fill progress. |
| **Trade** | mutable | Aggregate of all fills in one transaction for a single user and position session. Keyed by tx hash + user + session, so flipping a position in one tx yields one Trade per session rather than merging both into one row. This is what trade history shows. |
| **Fill** | immutable | One per user per `OrderMatched` leg: the individual execution against a counterparty, with both sides' orders, price, signed quantity, fee, and realized PnL. Keyed by tx hash + log index + leg suffix so a reopen leg cannot collide with the maker. Cash settlement and forced closes have no matched counterparty order, so they produce a Trade but no Fill. |
| **PositionSession** | mutable | One continuous position from open to flat, scoped to a (user, expiration) pair. Carries entry price, realized PnL, and liquidated quantity; ends when net quantity returns to zero. A user can hold several concurrently — one per expiration date. |
| **FuturesExpiration** | mutable | One expiration date and its cash-settlement metadata. Created lazily the first time anything at that date is indexed; `settlementPrice` stays null until `SettlementPriceRecorded` pins it, and its presence is the "settled" signal. Back-links to the orders, sessions, trades, and price levels at that date. |
| **PriceLevel** | mutable | Aggregated order book level: total quantity and order count per (expiration, price, side). |
| **BadDebtEvent** | immutable | Bad debt socialized when a participant or the insurance fund cannot cover a loss. |
| **LiquidationTx** | immutable | Per-tx sentinel keyed by tx hash. Carries no data; its existence lets `Futures.totalLiquidations` count liquidation transactions rather than legs. |
| **UserDeliverySessionPointer** | mutable | Internal lookup, not meant for UI queries: the open session, running net quantity, and entry price for a (user, expiration) pair. Exists because GraphQL has no map type to hang this off `User`. |

### Event Handlers

The subgraph listens to all `HashPowerFutures` contract events:

- **Order events** — `OrderCreated`, `OrderUpdated`, `OrderCancelled`, `OrderMatched`, `OrderLiquidated`
- **Position events** — `PositionLiquidated`, `PositionSettled`
- **Settlement events** — `SettlementPriceRecorded`
- **Config events** — `MakerFeeBpsUpdated`, `TakerFeeBpsUpdated`, `LiquidationFeeBpsUpdated`, `LiquidatorShareBpsUpdated`, `OracleUpdated`, `PortfolioMarginUpdated`, `FutureExpirationDatesCountUpdated`
- **Credit events** — `BadDebt`
- **Lifecycle events** — `Initialized`, `Upgraded`

On initialization, the handler also reads current contract state via `try_*` calls to populate the `Futures` singleton, including the `priceOracle()`, `portfolioMargin()`, and `vault()` addresses.

## Local Development

### Prerequisites

- Docker (for graph-node, IPFS, and Postgres)
- pnpm
- A running Ethereum node (local or remote) for graph-node to connect to
- The contracts package built, since the ABI is read from `../contracts/abi/HashPowerFutures.json`

### 1. Configure environment

```bash
cp .env.example ../.env
```

`pnpm prepare-local` sources `../.env` (the `futures-marketplace` root), so put the values there:

```
NETWORK=arbitrum-sepolia
FUTURES_ADDRESS=0x...
START_BLOCK_FUTURES=222848905
SUBGRAPH_ETH_NODE=arbitrum-sepolia:https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY
```

`SUBGRAPH_ETH_NODE` is the `ethereum` connection string for graph-node in `network:url` format, read by `docker-compose.yml`.

### 2. Start infrastructure

```bash
pnpm indexer   # docker-compose up (graph-node + IPFS + Postgres)
```

This starts:

- **graph-node** on ports 8000 (GraphQL), 8001 (WebSocket), 8020 (JSON-RPC admin), 8030 (index status), 8040 (metrics)
- **IPFS** on port 5001
- **Postgres** on port 5432

### 3. Build and deploy

```bash
pnpm setup-local
```

This runs the full pipeline: template substitution, codegen, build, create, and deploy. Alternatively, step by step:

```bash
pnpm prepare-local    # Substitute env vars into subgraph.yaml
pnpm codegen          # Generate AssemblyScript types from schema + ABI
pnpm build            # Compile the subgraph
pnpm create-local     # Register subgraph name with graph-node
pnpm deploy-local     # Deploy to local graph-node
```

### 4. Query

The GraphQL endpoint is available at:

```
http://localhost:8000/subgraphs/name/futures
```

## Testing

| Command | What it runs |
| --- | --- |
| `pnpm test:unit` | Matchstick unit tests over the mappings (`tests/`) |
| `pnpm test:integration` | Hardhat tests that deploy the contracts, emit real events, and assert on the indexed entities (`integration/`) |
| `pnpm typecheck` | Type-checks the integration suite |
| `pnpm lint` | Biome lint |

## Available Scripts

| Script | Description |
| --- | --- |
| `pnpm indexer` | Start graph-node + IPFS + Postgres via Docker Compose |
| `pnpm setup-local` | Full local pipeline: prepare, codegen, build, create, deploy |
| `pnpm prepare-local` | Substitute `../.env` vars into `subgraph.yaml` from template |
| `pnpm prepare:env` | Same substitution, but from the ambient environment (CI/ECS) |
| `pnpm codegen` | Generate AssemblyScript types |
| `pnpm build` | Compile the subgraph |
| `pnpm create-local` | Register subgraph with local graph-node |
| `pnpm deploy-local` | Deploy subgraph to local graph-node |
| `pnpm remove-local` | Remove subgraph from local graph-node |
| `pnpm deploy` | Deploy to The Graph Studio (hosted) |
| `pnpm clean` | Remove generated files, build artifacts, and data |

## Configuration

The subgraph manifest is generated from `subgraph.template.yaml` using `envsubst`. The template contains placeholders for:

- `${NETWORK}` — target network name
- `${FUTURES_ADDRESS}` — deployed contract address
- `${START_BLOCK_FUTURES}` — block to start indexing from, passed both as the data source `startBlock` and through the data source context so it lands on `Futures.startBlock`

## Example Queries

**Contract stats:**

```graphql
{
  futures(id: 0) {
    totalUsers
    totalOrders
    activeOrders
    totalTrades
    totalVolume
    totalLiquidations
    totalLiquidatedValue
    collectedFeesBalance
  }
}
```

**Order book depth for one expiration:**

```graphql
{
  priceLevels(
    where: { expirationAt: "1735689600", orderCount_gt: 0 }
    orderBy: price
    orderDirection: desc
  ) {
    price
    isBid
    totalQuantity
    orderCount
  }
}
```

**A user's open positions across expirations:**

```graphql
{
  positionSessions(where: { user: "0x...", status: OPEN }) {
    id
    expirationAt
    netQuantity
    entryPrice
    realizedPnl
    liquidatedQuantity
  }
}
```

**Trade history, newest first:**

```graphql
{
  trades(
    where: { user: "0x..." }
    first: 50
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    expirationAt
    tradePrice
    tradeQuantity
    tradingFee
    realizedPnl
    netQuantityAfter
    isLiquidation
    timestamp
  }
}
```

**Settlement status per expiration:**

```graphql
{
  futuresExpirations(orderBy: expirationAt) {
    expirationAt
    settlementPrice
    settledAt
    recordedBy
  }
}
```

**Top traders by realized PnL:**

```graphql
{
  users(
    first: 10
    orderBy: realizedPnl
    orderDirection: desc
    where: { tradeCount_gt: 0 }
  ) {
    address
    realizedPnl
    tradeCount
    fillCount
  }
}
```
