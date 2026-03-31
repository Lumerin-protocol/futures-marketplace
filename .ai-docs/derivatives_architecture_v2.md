# Derivatives Marketplace Architecture v2

> **Date**: February 2026  
> **Status**: Planning / Discussion  
> **Reference**: Analysis of Aster DEX and similar perp DEX platforms

## Executive Summary

This document outlines the architectural considerations for evolving the Futures Marketplace into a full Derivatives platform with sub-second order book updates, real-time data streaming, and professional trading UX comparable to platforms like Aster DEX, dYdX, and Hyperliquid.

---

## Current State Analysis

### What We Have Today

| Component | Current Implementation | Limitation |
|-----------|----------------------|------------|
| Data Fetching | Subgraph + 15-second polling | Too slow for trading UX |
| Order Execution | Direct on-chain transactions | Gas costs, 12-15s finality |
| Real-time Updates | None (polling only) | No WebSocket/push capability |
| Order Book | On-chain only | Cannot support limit order books |
| Backend Jobs | Lambda (margin calls, market maker) | Scheduled, not event-driven |

### Current Tech Stack

**Frontend:**
- React 18.3 + TypeScript + Vite
- TailwindCSS + Material-UI
- Wagmi 2.15 + Viem 2.22 (Web3)
- React Query (TanStack Query) for data fetching
- Highcharts for charting
- GraphQL (graphql-request) for subgraph queries

**Backend:**
- Notifications Service: ECS Fargate + PostgreSQL + Telegram bot
- Margin Call Service: Lambda (scheduled)
- Market Maker Service: Lambda (scheduled)

**Indexing:**
- The Graph Subgraph (AssemblyScript)
- ~10-30 second indexing delay

**Infrastructure:**
- AWS: S3 + CloudFront (UI), ECS Fargate, Lambda, RDS PostgreSQL
- Terraform/Terragrunt IaC

---

## Target State: What Professional Perp DEXs Look Like

### Industry Reference: Aster DEX

**Technical Specs (from their API docs):**
- REST API: `https://fapi.asterdex.com`
- WebSocket: `wss://fstream.asterdex.com/ws`
- Rate Limit: 1200 weight/min
- Features: 1001x leverage, grid trading, hedge mode, pre-launch contracts

**Key Characteristics:**
- Sub-100ms order book updates
- Real-time position/PnL streaming
- Off-chain order matching
- On-chain settlement (batched)

### Industry Architecture Patterns

| Platform | Architecture | Matching | Settlement |
|----------|--------------|----------|------------|
| **Aster DEX** | Hybrid off-chain/on-chain | Off-chain engine | On-chain batched |
| **dYdX v4** | Cosmos app-chain | Validator memory pools | Consensus layer |
| **Hyperliquid** | Custom L1 (HyperCore) | Native on-chain orderbook | Sub-1s finality |
| **GMX** | Oracle-based | No order book (LP pools) | Immediate |
| **EVEDEX** | L3 + off-chain engine | 100k orders/sec, 100μs | L3 settlement |

**Industry Consensus:** Hybrid model with off-chain matching + on-chain settlement is the pragmatic choice for speed without building a custom chain.

---

## Proposed Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                          │
│                    (React + WebSocket Client)                   │
│              TradingView Charts | Order Entry | Positions       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WSS + REST
┌──────────────────────────▼──────────────────────────────────────┐
│                        API Gateway                               │
│         ┌─────────────────┬─────────────────┐                   │
│         │  REST API       │  WebSocket API  │                   │
│         │  (Orders, Auth) │  (Streams)      │                   │
│         └────────┬────────┴────────┬────────┘                   │
└──────────────────┼─────────────────┼────────────────────────────┘
                   │                 │
┌──────────────────▼─────────────────▼────────────────────────────┐
│                    Application Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Order     │  │  Order Book │  │  Position   │              │
│  │  Service    │  │   Service   │  │  Service    │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          ▼                                       │
│              ┌───────────────────────┐                          │
│              │    Matching Engine    │                          │
│              │   (Price-Time FIFO)   │                          │
│              └───────────┬───────────┘                          │
└──────────────────────────┼──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                      Data Layer                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Redis    │  │  PostgreSQL │  │  Timestream │              │
│  │ (Order Book │  │  (Trades,   │  │  (Market    │              │
│  │  State,     │  │   Users,    │  │   Data,     │              │
│  │  Pub/Sub)   │  │   History)  │  │   OHLCV)    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                   Blockchain Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Event     │  │ Settlement  │  │  Subgraph   │              │
│  │  Listener   │  │  Service    │  │ (Historical │              │
│  │ (WebSocket  │  │  (Batched   │  │  Queries)   │              │
│  │  RPC)       │  │  On-chain)  │  │             │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Real-Time Data Layer (WebSocket Infrastructure)

**Purpose:** Replace 15-second polling with push-based updates.

**AWS Services:**
| Service | Purpose | Why |
|---------|---------|-----|
| API Gateway WebSocket | Managed WebSocket connections | Auto-scaling, pay-per-message |
| ElastiCache Redis | In-memory state + pub/sub | Sub-ms latency, broadcast support |
| Kinesis Data Streams | High-throughput event streaming | Ordered, durable event log |

**Data Streams to Implement:**
```
Streams:
├── orderbook@{symbol}      # Order book snapshots + deltas
├── trades@{symbol}         # Real-time trade feed
├── ticker@{symbol}         # Price/volume updates
├── position@{user}         # User position updates
├── account@{user}          # Balance/margin updates
└── liquidations@{symbol}   # Liquidation events
```

#### 2. Order Management System

**Order Flow (Off-Chain Matching Model):**
```
1. User signs order (EIP-712 typed data)
2. Order submitted to REST API
3. Order validated (signature, balance, risk)
4. Order added to in-memory order book
5. Matching engine processes (price-time priority)
6. Matched orders → settlement queue
7. Settlement service batches → on-chain execution
8. WebSocket broadcasts updates to all subscribers
```

**Order Types to Support:**
- Market orders
- Limit orders (GTC, IOC, FOK)
- Stop-loss / Take-profit
- Trailing stop
- Reduce-only orders

#### 3. Matching Engine

**Options:**

| Approach | Latency | Decentralization | Build Effort |
|----------|---------|------------------|--------------|
| **Off-chain (Recommended)** | <100ms | Low (trust operator) | Medium |
| L2/Rollup native orderbook | 1-2s | Medium | High |
| Pure on-chain | 12-15s | High | Low (current) |

**Recommended: Off-Chain Matching Engine**

Characteristics:
- In-memory order book (Redis-backed persistence)
- Price-time priority matching algorithm
- Self-match prevention
- Fat-finger protection
- Circuit breakers

**Technology Options:**
- Custom Node.js/Go service
- Open-source engines (Galoy, OpenDAX)
- Commercial (Exberry, Nasdaq matching engine)

#### 4. Settlement Layer

**Batched Settlement Pattern:**
```
┌─────────────────────────────────────────┐
│           Settlement Service            │
├─────────────────────────────────────────┤
│ 1. Collect matched trades (5-30s batch) │
│ 2. Aggregate by user                    │
│ 3. Build multicall transaction          │
│ 4. Submit to blockchain                 │
│ 5. Wait for confirmation                │
│ 6. Update local state on success        │
│ 7. Handle failures / retries            │
└─────────────────────────────────────────┘
```

**Smart Contract Enhancements Needed:**
- Batch trade execution function
- Operator signature verification
- Nonce management for replay protection
- Emergency withdrawal mechanism (trustless exit)

#### 5. Event Listener Service

**Replace Subgraph for Real-Time (Keep for Historical)**

```typescript
// Pseudo-code for event listener
const provider = new WebSocketProvider(rpcUrl);

// Subscribe to contract events
contract.on('PositionOpened', async (event) => {
  // 1. Process event immediately
  const position = parsePositionEvent(event);
  
  // 2. Update Redis state
  await redis.hset(`positions:${event.user}`, position);
  
  // 3. Broadcast to subscribers
  await redis.publish(`position@${event.user}`, JSON.stringify(position));
  
  // 4. Persist to PostgreSQL
  await db.positions.upsert(position);
});
```

---

## AWS Infrastructure Requirements

### New Resources Needed

```hcl
# New Terraform resources to add

# 1. WebSocket API Gateway
resource "aws_apigatewayv2_api" "websocket" {
  name                       = "${var.environment}-derivatives-ws"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

# 2. ElastiCache Redis Cluster
resource "aws_elasticache_replication_group" "orderbook" {
  replication_group_id       = "${var.environment}-orderbook-cache"
  description                = "Order book state and pub/sub"
  node_type                  = "cache.r6g.large"
  num_cache_clusters         = 2
  engine                     = "redis"
  engine_version             = "7.0"
  port                       = 6379
  automatic_failover_enabled = true
}

# 3. Kinesis Data Stream
resource "aws_kinesis_stream" "trades" {
  name             = "${var.environment}-trade-events"
  shard_count      = 2
  retention_period = 24

  stream_mode_details {
    stream_mode = "PROVISIONED"
  }
}

# 4. ECS Service for Order Book Service
resource "aws_ecs_service" "orderbook_service" {
  name            = "${var.environment}-orderbook-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.orderbook.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  
  # ... network configuration
}

# 5. EC2 for Matching Engine (if low-latency required)
resource "aws_instance" "matching_engine" {
  ami           = var.amazon_linux_ami
  instance_type = "c6i.xlarge"
  
  # Placement group for low-latency networking
  placement_group = aws_placement_group.trading.id
  
  # ... configuration
}

# 6. Timestream for Market Data
resource "aws_timestreamwrite_database" "market_data" {
  database_name = "${var.environment}-market-data"
}

resource "aws_timestreamwrite_table" "ohlcv" {
  database_name = aws_timestreamwrite_database.market_data.database_name
  table_name    = "ohlcv"
  
  retention_properties {
    memory_store_retention_period_in_hours  = 24
    magnetic_store_retention_period_in_days = 365
  }
}
```

### Cost Estimates

| Component | AWS Service | Monthly Cost (Mid-Traffic) |
|-----------|-------------|---------------------------|
| WebSocket API | API Gateway WebSocket | $50-200 |
| Order Book State | ECS Fargate (2 tasks) | $100-200 |
| Redis Cache | ElastiCache r6g.large (2 nodes) | $300 |
| Event Streaming | Kinesis (2 shards) | $50 |
| Market Data | Timestream | $50-100 |
| Matching Engine | EC2 c6i.xlarge | $150 |
| Existing (RDS, etc.) | - | $200-400 |
| **Total Estimate** | | **$900-1,400/mo** |

*Note: Costs scale with traffic. High-volume trading could be 3-5x.*

---

## Implementation Phases

### Phase 1: Real-Time Foundation (4-6 weeks)

**Goal:** Replace polling with WebSocket push for existing data.

**Tasks:**
- [ ] Deploy API Gateway WebSocket API
- [ ] Deploy ElastiCache Redis cluster
- [ ] Build Event Listener Service (replace subgraph for real-time)
- [ ] Build WebSocket broadcast service
- [ ] Update UI to connect via WebSocket
- [ ] Keep subgraph for historical queries

**Deliverables:**
- Real-time position updates (<1s latency)
- Real-time price feed
- WebSocket connection management in UI

### Phase 2: Order Book Infrastructure (6-8 weeks)

**Goal:** Build off-chain order book and matching capability.

**Tasks:**
- [ ] Design order submission API (EIP-712 signed orders)
- [ ] Build Order Book Service (in-memory + Redis)
- [ ] Implement matching engine (price-time priority)
- [ ] Build order book WebSocket streams
- [ ] Integrate TradingView charts (replace Highcharts)
- [ ] Build order entry UI components

**Deliverables:**
- Functional limit order book
- Real-time order book visualization
- Professional charting

### Phase 3: Settlement Layer (4-6 weeks)

**Goal:** Connect off-chain matching to on-chain execution.

**Tasks:**
- [ ] Design batch settlement contract
- [ ] Build Settlement Service
- [ ] Implement reconciliation logic
- [ ] Add trustless withdrawal mechanism
- [ ] Build admin tools for settlement monitoring

**Deliverables:**
- Batched trade settlement
- Settlement dashboard
- Withdrawal guarantees

### Phase 4: Production Hardening (4-6 weeks)

**Goal:** Production-ready with security and reliability.

**Tasks:**
- [ ] Rate limiting and DDoS protection
- [ ] Circuit breakers and position limits
- [ ] Audit trail and compliance logging
- [ ] Load testing (target: 1000 orders/sec)
- [ ] Chaos engineering / failure testing
- [ ] Security audit (smart contracts + backend)
- [ ] Runbooks and incident response

**Deliverables:**
- Production deployment
- Operational documentation
- Monitoring and alerting

---

## Key Architectural Decisions

### Decision 1: Order Matching Model

| Option | Latency | Decentralization | Recommended |
|--------|---------|------------------|-------------|
| **Off-chain matching** | <100ms | Low | ✅ Yes |
| L2/App-chain | 1-2s | Medium | Future consideration |
| Pure on-chain | 12-15s | High | Current (not scalable) |

**Recommendation:** Off-chain matching with on-chain settlement. This is the industry standard for performance.

**Trade-off:** Users must trust the operator for order execution. Mitigated by:
- Transparent matching rules
- Audit logs
- Trustless withdrawal mechanism

### Decision 2: WebSocket vs. GraphQL Subscriptions

| Option | Pros | Cons |
|--------|------|------|
| **Custom WebSocket** | Full control, lower latency | More code to maintain |
| GraphQL Subscriptions | Familiar pattern | Higher overhead, subgraph dependency |

**Recommendation:** Custom WebSocket API. More flexible, lower latency, no subgraph dependency for real-time data.

### Decision 3: Matching Engine Build vs. Buy

| Option | Cost | Time | Risk |
|--------|------|------|------|
| **Build custom** | Dev time | 4-8 weeks | Medium |
| Open-source (OpenDAX) | Free | 2-4 weeks | Integration complexity |
| Commercial (Exberry) | $10k+/mo | 2 weeks | Vendor dependency |

**Recommendation:** Build custom for initial version. The matching logic itself is straightforward; the complexity is in the surrounding infrastructure.

### Decision 4: Data Storage Strategy

| Data Type | Storage | Why |
|-----------|---------|-----|
| Order book state | Redis | Speed, pub/sub |
| User sessions | Redis | Speed |
| Trade history | PostgreSQL | Queries, joins |
| Market data (OHLCV) | Timestream | Time-series optimized |
| Blockchain events | PostgreSQL + Subgraph | Historical queries |

---

## Security Considerations

### Off-Chain Matching Risks

1. **Operator trust** - Users trust operator to execute fairly
   - Mitigation: Audit logs, deterministic matching rules
   
2. **Front-running** - Operator could see orders before execution
   - Mitigation: Commit-reveal scheme, or encrypted order submission
   
3. **Availability** - Off-chain system down = no trading
   - Mitigation: Multi-region deployment, fallback to on-chain
   
4. **Fund custody** - Collateral held in smart contracts
   - Mitigation: Trustless withdrawal mechanism (escape hatch)

### Smart Contract Security

- Formal verification of settlement contract
- Time-locked upgrades
- Multi-sig admin controls
- Emergency pause functionality

### Infrastructure Security

- VPC isolation for backend services
- WAF on API Gateway
- DDoS protection (Shield Advanced)
- Secrets in AWS Secrets Manager
- Encryption at rest and in transit

---

## Open Questions

1. **Regulatory implications** - Does off-chain matching change our regulatory posture?

2. **Target markets** - Which derivatives first? (Perps, options, structured products)

3. **Leverage limits** - What max leverage? (Industry: 20x-100x+ for perps)

4. **Liquidation engine** - Keep current Lambda or build dedicated service?

5. **Market maker integration** - How do we onboard professional MMs?

6. **Cross-margin** - Single margin pool across positions?

7. **Multi-asset collateral** - Accept multiple tokens as margin?

---

## References

- [Aster DEX API Documentation](https://docs.asterdex.com/product/aster-perpetuals/api/api-documentation)
- [dYdX Chain Architecture](https://docs.dydx.exchange/concepts-architecture/architectural_overview)
- [Hyperliquid Architecture](https://hyperliquid-co.gitbook.io/wiki/architecture/hypercore)
- [AWS Low-Latency Exchange Architecture](https://aws.amazon.com/blogs/industries/low-latency-cloud-native-exchanges)
- [Exberry Cloud-Native Matching Engine](https://aws.amazon.com/blogs/industries/how-exberry-built-a-cloud-native-matching-engine-on-aws-that-can-process-1-million-trades-per-sec-with-20-microseconds-latency/)

---

## Appendix: UI Technology Upgrade

### Current → Recommended

| Component | Current | Recommended | Why |
|-----------|---------|-------------|-----|
| Charts | Highcharts | TradingView | Industry standard, more features |
| Order Book | Custom | TradingView widget or custom | Real-time depth visualization |
| Data Fetching | React Query + Polling | React Query + WebSocket | Real-time updates |
| State Management | React Query | Zustand + React Query | Complex trading state |

### TradingView Integration

TradingView provides:
- Professional charting library
- Built-in drawing tools
- Custom indicators
- Order visualization on charts
- Mobile-responsive

Integration effort: ~2-3 weeks for basic, ~4-6 weeks for full feature parity.
