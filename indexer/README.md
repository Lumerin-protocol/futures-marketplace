# Futures Subgraph

This subgraph indexes the HashPowerFutures contract (including its HashpriceUSD / AggregatorV3 oracle address) to track positions, orders, and market activity.

> **Cash settlement (contract `2.15.0`).** Futures are cash-settled at maturity. Settlement
> surfaces as `LotClosed` with `reason = SETTLED`, emitted by the permissionless `settlePosition`.

## Entities

### Futures Contract Entities

- **Participant**: Tracks users who create positions or orders

  - `id`: Participant address
  - `positions`: Array of position IDs
  - `orders`: Array of order IDs
  - `positionCount`: Number of positions
  - `orderCount`: Number of orders
  - `totalVolume`: Total volume traded

- **Position**: Tracks individual futures positions

  - `id`: Position ID (bytes32)
  - `participant`: Participant who created the position
  - `price`: Position price
  - `deliveryDate`: Expiration date for the position
  - `isBuy`: Whether this is a buy (long) or sell (short) position
  - `timestamp`: When the position was created
  - `isActive`: Whether the position is still active
  - `closedAt`: When the position was closed (if closed)
  - `closedBy`: Who closed the position

- **Order**: Tracks futures orders between participants
  - `id`: Order ID (bytes32)
  - `seller`: Seller participant
  - `buyer`: Buyer participant
  - `price`: Order price
  - `startTime`: When the order starts
  - `timestamp`: When the order was created
  - `isActive`: Whether the order is still active
  - `closedAt`: When the order was closed (if closed)
  - `closedBy`: Who closed the order

## Event Handlers

### Futures Contract Events

1. **Initialized**: Creates the root Futures entity when the contract is initialized
2. **PositionCreated**: Creates a new position entity and updates participant stats
3. **PositionClosed**: Marks a position as closed and updates stats
4. **OrderCreated**: Creates a new order entity and updates participant stats
5. **OrderClosed**: Marks an order as closed and updates stats

## Configuration

The subgraph is configured in `subgraph.template.yaml` with:

- HashPowerFutures contract address and ABI
- Event handlers for all relevant events
- `HASHPRICE_USD_ADDRESS` is read from the HashPowerFutures contract (`hashrateOracle()` getter) and stored on the Futures entity

## Usage

1. Deploy the subgraph using the template configuration
2. The subgraph will automatically index HashPowerFutures events
3. Query the entities to get position and order data

## Example Queries

```graphql
# Get all active positions
{
  positions(where: { isActive: true }) {
    id
    participant
    price
    deliveryDate
    isBuy
  }
}

# Get hashrate timeseries data
{
  hashesForTokens(orderBy: calculatedAt, orderDirection: desc, first: 100) {
    value
    calculatedAt
    btcPrice
    hashesForBTC
  }
}

# Get participant activity
{
  participants {
    id
    positionCount
    orderCount
    totalVolume
  }
}
```
