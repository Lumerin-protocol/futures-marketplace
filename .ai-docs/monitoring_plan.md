# Futures Marketplace - Monitoring & Alerting Guide

## Overview

The Futures Marketplace provides a DeFi hashrate trading platform. This guide explains how we ensure the environment stays healthy through CloudWatch monitoring, alarms, and dashboards.

### System Components

| Component | Purpose | Critical? |
|-----------|---------|-----------|
| **Futures UI** | Static React app for trading interface | Yes - users can't trade without it |
| **Market Maker** | Automated trading bot for liquidity | Yes - market liquidity depends on it |
| **Margin Call Lambda** | Monitors positions and triggers margin calls | Yes - position health depends on it |
| **Notifications Service** | Telegram/HTTP notifications for users | No - graceful degradation acceptable |
| **Notifications RDS** | PostgreSQL database for notification state | No - supports non-critical service |

---

## Dashboard Quick Reference

**Dashboard Name:** `00-FuturesMarketplace-{env}`

Open in CloudWatch Console → Dashboards → `00-FuturesMarketplace-dev` (or stg/lmn)

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Row 1: Futures UI Health                                                     │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                 │
│ │ Route53 Health  │ │ CloudFront 4xx  │ │ CloudFront 5xx  │                 │
│ │ Check Status    │ │ Error Rate      │ │ Error Rate      │                 │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ Row 2: Market Maker                                                          │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                 │
│ │ Running Tasks   │ │ CPU/Memory      │ │ Transaction     │                 │
│ │                 │ │ Utilization     │ │ Failures        │                 │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ Row 3: Margin Call Lambda                                                    │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                 │
│ │ Invocations     │ │ Errors          │ │ Duration        │                 │
│ │                 │ │                 │ │                 │                 │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ Row 4: Notifications Service                                                 │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                 │
│ │ ECS Tasks       │ │ ALB Requests    │ │ ALB Latency     │                 │
│ │ CPU/Memory      │ │ 5xx Errors      │ │ p50/p95/p99     │                 │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ Row 5: RDS PostgreSQL                                                        │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                 │
│ │ CPU Utilization │ │ Free Storage    │ │ Connections     │                 │
│ │                 │ │ (GB)            │ │                 │                 │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Metrics to Watch

| Widget | Healthy State | Warning Signs |
|--------|---------------|---------------|
| **Route53 Health** | 100% healthy | Any failures |
| **CloudFront Errors** | < 5% errors | > 5% sustained |
| **Market Maker Tasks** | 1 running | 0 tasks |
| **Margin Call Errors** | 0 | Any errors |
| **RDS Storage** | > 10 GB free | < 5 GB free |

---

## Alarm Architecture

### Two-Tier System

We use a **two-tier alarm system** to prevent alert flooding:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      COMPOSITE ALARMS (Alert Layer)                          │
│                  ↓ Only these send SNS notifications ↓                       │
│                                                                              │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│    │futures-ui    │  │market-maker  │  │margin-call   │  │notifications │   │
│    │              │  │              │  │              │  │              │   │
│    └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│           │                 │                 │                 │            │
└───────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
            │                 │                 │                 │
            ▼                 ▼                 ▼                 ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                     COMPONENT ALARMS (State Layer)                            │
│                 ↓ NO notifications - state tracking only ↓                    │
│                                                                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │5xx_err  │ │cpu_high │ │mem_high │ │errors   │ │duration │ │storage  │    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
│                                                                               │
│  Visible in CloudWatch Alarms console for debugging                           │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Why This Design?

**Without composites:** If CPU goes high, you'd get:
- Alert: "CPU High" 
- Alert: "Market Maker Unhealthy" (because CPU triggered composite)
- That's noise!

**With composites:** You get ONE alert: "Market Maker Unhealthy"
- Go to dashboard
- See which component triggered it
- Take action

---

## Composite Alarms Reference

### futures-ui-{env}
**Triggers when:** Futures UI is unreachable or erroring

| Component Alarm | Condition | Severity |
|-----------------|-----------|----------|
| `futures-ui-5xx-errors` | CloudFront 5xx rate > threshold | Critical |
| `futures-ui-4xx-errors` | CloudFront 4xx rate > threshold | Warning |
| `futures-ui-unreachable` | Route53 health check failing | Critical |
| `canary-failed` (LMN only) | Synthetics canary failing | Critical |

**Response:**
1. Check Route53 health check status in AWS Console
2. If unreachable: Check CloudFront distribution, S3 origin
3. If 5xx errors: Check S3 bucket permissions, CloudFront config
4. If 4xx errors: Check for missing assets, broken links

---

### market-maker-{env}
**Triggers when:** Market Maker service is unhealthy

| Component Alarm | Condition | Severity |
|-----------------|-----------|----------|
| `market-maker-running-tasks` | Running tasks = 0 | Critical |
| `market-maker-cpu-high` | CPU > threshold | Warning |
| `market-maker-memory-high` | Memory > threshold | Warning |

**Response:**
1. Check ECS console for task status and events
2. If no tasks: Check for deployment failures, resource limits
3. If CPU/Memory high: Check for trading loops, memory leaks
4. Review logs: CloudWatch → `/ecs/market-maker-{env}`

---

### margin-call-{env}
**Triggers when:** Margin Call Lambda is failing

| Component Alarm | Condition | Severity |
|-----------------|-----------|----------|
| `margin-call-errors` | Lambda errors > threshold | Critical |
| `margin-call-duration` | Execution time too long | Warning |
| `margin-call-throttles` | Lambda throttled | Warning |

**Response:**
1. Check Lambda logs: CloudWatch → `/aws/lambda/margin-call-v2-{env}`
2. If errors: Check contract interactions, RPC endpoint
3. If duration high: Check chain congestion, contract complexity
4. If throttled: Check Lambda concurrency limits

---

### notifications-{env}
**Triggers when:** Notifications service is unhealthy

| Component Alarm | Condition | Severity |
|-----------------|-----------|----------|
| `notifications-running-tasks` | Running tasks = 0 | Critical |
| `notifications-cpu-high` | CPU > threshold | Warning |
| `notifications-memory-high` | Memory > threshold | Warning |
| `notifications-alb-5xx` | ALB 5xx errors > threshold | Warning |
| `notifications-alb-unhealthy` | ALB unhealthy hosts > 0 | Critical |

**Response:**
1. Check ECS console for task health
2. If ALB unhealthy: Check health check endpoint
3. Review logs: CloudWatch → `/ecs/futures-notifications-{env}`

---

### notificationsrds-{env}
**Triggers when:** Notifications RDS is unhealthy

| Component Alarm | Condition | Severity |
|-----------------|-----------|----------|
| `notifications-rds-cpu` | CPU > threshold | Warning |
| `notifications-rds-storage` | Free storage < threshold | Critical |
| `notifications-rds-connections` | Connections > threshold | Warning |

**Response:**
1. If storage low: Increase allocated storage in RDS Console
2. If CPU high: Check for slow queries, consider scaling
3. If connections high: Restart services to release connections

---

## UI Reachability Monitoring

The Futures UI uses a multi-layer monitoring approach:

### Route53 Health Check (All Environments)
Active probing every 30 seconds from multiple AWS edge locations.

```
Route53 Health Check
    │
    ▼
HTTPS GET → https://futures.{domain}/
    │
    ▼
Check: HTTP 200 response within 4 seconds
    │
    ▼
CloudWatch Metric: HealthCheckStatus (1=healthy, 0=unhealthy)
```

### Synthetics Canary (Production Only)
Browser-based testing that loads the page and verifies content renders.

```
Synthetics Canary (every 15 min in LMN)
    │
    ▼
Selenium browser loads https://futures.lumerin.io
    │
    ▼
Checks:
  - Page loads successfully
  - Key content renders
  - No JavaScript errors
    │
    ▼
CloudWatch Metrics:
  - SuccessPercent (0-100%)
  - Duration (ms)
```

### Environment Configuration

| Environment | Route53 Health | Canary | Canary Rate |
|-------------|----------------|--------|-------------|
| DEV | ✅ Yes | ❌ No | - |
| STG | ✅ Yes | ❌ No | - |
| LMN | ✅ Yes | ✅ Yes | 15 min |

**Rationale:** Route53 health checks provide basic reachability monitoring for all environments. Production (LMN) gets the additional Synthetics Canary to verify the page actually renders correctly.

---

## Alarm Timing Configuration

### The `unhealthy_alarm_period_minutes` Concept

This variable controls how long a condition can be "bad" before a component alarm triggers:

| Environment | Unhealthy Period | Effect |
|-------------|------------------|--------|
| DEV | 60 min | Very tolerant - issues must persist 60 min |
| STG | 30 min | Moderate - issues must persist 30 min |
| LMN | 15 min | Strict - production alerts after 15 min |

### How Evaluation Periods Are Calculated

Different metric sources have different native reporting periods:

| Metric Type | Native Period | Example Metrics |
|-------------|---------------|-----------------|
| Standard CloudWatch | 5 min | ECS CPU/Memory, Lambda errors, RDS |
| Route53 Health | 1 min | Health check status |
| Synthetics Canary | Configurable | SuccessPercent, Duration |

**Formula:** `evaluation_periods = unhealthy_alarm_period / native_period`

**Example (LMN with 15 min unhealthy period):**
- ECS alarms: `15 / 5 = 3 evaluation periods` of 5 min each
- Route53 alarms: `15 / 1 = 15 evaluation periods` of 1 min each
- Canary alarms (15 min rate): `15 / 15 = 1 evaluation period`

---

## Environment Configuration

### Notification Settings

| Environment | notifications_enabled | Alert Target |
|-------------|----------------------|--------------|
| DEV | `false` | None (console only) |
| STG | `false` | None (console only) |
| LMN/Prod | `true` | SNS → DevOps phones |

### Threshold Examples

| Threshold | DEV | LMN/Prod | Notes |
|-----------|-----|----------|-------|
| `ecs_cpu_threshold` | 90% | 80% | Lower in prod for earlier warning |
| `ecs_memory_threshold` | 90% | 85% | Lower in prod |
| `lambda_error_threshold` | 5 | 1 | Strict in prod |
| `rds_storage_threshold` | 5 GB | 10 GB | More headroom in prod |
| `cloudfront_5xx_threshold` | 5% | 2% | Stricter in prod |

### Monitoring Schedule

| Setting | DEV | STG | LMN/Prod | Notes |
|---------|-----|-----|----------|-------|
| `synthetics_canary_rate_minutes` | 60 | 30 | 15 | How often canary runs (if enabled) |
| `unhealthy_alarm_period_minutes` | 60 | 30 | 15 | How long before alarm triggers |

---

## File Structure

```
.bedrock/.terragrunt/
├── 70_monitoring_common.tf     # IAM, data sources, alarm action locals
├── 71_metric_filters.tf        # CloudWatch Log metric filters
├── 72_synthetics_canary.tf     # Synthetics canary (production)
├── 72_synthetics_canary.py     # Python Selenium canary script
├── 80_alarms.tf                # Component alarms (no notifications)
├── 81_composite_alarms.tf      # Composite alarms (notifications)
└── 89_dashboards.tf            # CloudWatch dashboard
```

---

## Runbook: Responding to Alerts

### Alert: "futures-ui-{env}"

1. **Open Dashboard:** CloudWatch → Dashboards → `00-FuturesMarketplace-{env}`
2. **Check Route53 Health:**
   - Route53 Console → Health checks
   - If unhealthy: Check CloudFront, S3 bucket
3. **Check CloudFront:**
   - CloudFront Console → Distribution → Error pages
   - Check S3 origin bucket exists and is accessible
4. **If Canary failing (LMN):**
   - Check Synthetics Console for screenshots
   - Look for JavaScript errors in canary logs

### Alert: "market-maker-{env}"

1. **Open Dashboard:** Check "Market Maker" row
2. **If no tasks running:**
   - ECS Console → Cluster → Service → Events
   - Look for deployment failures
3. **If CPU/Memory high:**
   - Check trading logs for unusual activity
   - Consider scaling task resources
4. **Check logs:**
   - CloudWatch → Log groups → `/ecs/market-maker-{env}`

### Alert: "margin-call-{env}"

1. **Check Lambda invocations:**
   - Lambda Console → Functions → margin-call-v2-{env} → Monitor
2. **If errors:**
   - Check logs for error details
   - Verify RPC endpoint is responsive
   - Check wallet has gas for transactions
3. **If duration high:**
   - Chain may be congested
   - Contract queries may be timing out

### Alert: "notifications-{env}" or "notificationsrds-{env}"

1. **Check ECS service health:**
   - ECS Console → Service → Tasks
2. **Check RDS:**
   - RDS Console → Databases → Performance Insights
3. **If storage low:**
   - Increase allocated storage (non-disruptive)

---

## Maintenance Tasks

### Weekly Review
- Check dashboard for trends (storage growth, memory creep)
- Review any alarms that fired
- Verify Lambda schedules are executing

### Monthly Review
- Review and adjust thresholds based on observed patterns
- Check CloudWatch costs
- Verify SNS subscriptions are active

### After Deployments
- Watch for increased error rates
- Monitor Lambda invocation success
- Check ECS service stability

---

## Terraform Variables Reference

### monitoring object
```hcl
monitoring = {
  create                   = bool   # Master switch for all monitoring
  create_alarms            = bool   # Create CloudWatch alarms
  create_dashboards        = bool   # Create CloudWatch dashboard
  create_metric_filters    = bool   # Create log metric filters
  create_synthetics_canary = bool   # Create Synthetics canary (LMN only)
  notifications_enabled    = bool   # Enable SNS notifications
  dev_alerts_topic_name    = string # SNS topic for Slack
  devops_alerts_topic_name = string # SNS topic for critical alerts
  dashboard_period         = number # Dashboard refresh (seconds)
}
```

### monitoring_schedule object
```hcl
monitoring_schedule = {
  synthetics_canary_rate_minutes = number  # How often canary runs (5-60 min)
  unhealthy_alarm_period_minutes = number  # How long to tolerate "bad" before alarm
}
```

**How it works:**
- `synthetics_canary_rate_minutes` - How often the browser test runs (if enabled)
- `unhealthy_alarm_period_minutes` - Controls alarm sensitivity across all alarms
- Evaluation periods are auto-calculated: `unhealthy_alarm_period / metric_native_period`

**Example (LMN with 15 min canary rate, 15 min unhealthy period):**
- Canary runs every 15 min
- If unhealthy, alarm fires after 15 min (1 consecutive bad reading)
- Standard ECS/Lambda alarms also fire after 15 min (3 × 5-min periods)

### alarm_thresholds object
```hcl
alarm_thresholds = {
  ecs_cpu_threshold           = number  # ECS CPU % (0-100)
  ecs_memory_threshold        = number  # ECS Memory % (0-100)
  ecs_min_running_tasks       = number  # Minimum running tasks
  lambda_error_threshold      = number  # Lambda error count
  lambda_duration_threshold   = number  # Lambda duration (ms)
  lambda_throttle_threshold   = number  # Lambda throttle count
  alb_5xx_threshold           = number  # ALB 5xx error count
  alb_unhealthy_threshold     = number  # ALB unhealthy hosts
  alb_latency_threshold       = number  # ALB latency (seconds)
  rds_cpu_threshold           = number  # RDS CPU %
  rds_storage_threshold       = number  # RDS free storage (GB)
  rds_connections_threshold   = number  # RDS connection count
  cloudfront_5xx_threshold    = number  # CloudFront 5xx %
  cloudfront_4xx_threshold    = number  # CloudFront 4xx %
}
```

---

## CloudWatch Log Groups

| Log Group | Service | Notes |
|-----------|---------|-------|
| `/ecs/market-maker-{env}` | Market Maker ECS | Trading bot logs |
| `/ecs/futures-notifications-{env}` | Notifications ECS | Telegram/HTTP logs |
| `/aws/lambda/margin-call-v2-{env}` | Margin Call Lambda | Position checks |
| `bedrock-futures-marketplace-ecs-cluster-{env}` | ECS Cluster | Cluster-level logs |

---

*Document Version: 2.0*
*Last Updated: 2026-01-24*
*Repository: futures-marketplace*
