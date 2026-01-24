# Futures Marketplace Monitoring Plan

> **Internal Document** - Guidelines for implementing CloudWatch monitoring for futures-marketplace infrastructure

## Overview

This document outlines the monitoring strategy for the Futures Marketplace services defined in the `.bedrock` folder of this repository.

**Scope**: ONLY resources defined in `/Volumes/moon/repo/hub/futures-marketplace/.bedrock/`

## Infrastructure Inventory (This Repo Only)

### Resources Defined in .bedrock/.terragrunt/

| File | Component | Resource Type | Description |
|------|-----------|---------------|-------------|
| `03_ecs_cluster.tf` | ECS Cluster | ECS | `ecs-futures-marketplace-{env}` |
| `04_futures_ui.tf` | Futures UI | S3 + CloudFront | Static website (`futures.{domain}`) |
| `06_notifications_service.tf` | Notifications | ECS + RDS + ALB | Telegram bot service |
| `07_margin_call_lambda.tf` | Margin Call | Lambda | Position monitoring (every 15 min) |
| `10_market_maker_svc.tf` | Market Maker | ECS | Automated trading bot |

### Deployment Status by Environment

| Environment | UI (CloudFront) | ECS Cluster | Market Maker | Notifications | Margin Call |
|-------------|-----------------|-------------|--------------|---------------|-------------|
| **DEV** | ✅ Deployed | ✅ Deployed | ✅ Running | ✅ Running | ✅ Running |
| **STG** | ✅ Deployed | ❌ Not deployed | ❌ | ❌ | ❌ |
| **LMN** | ✅ Deployed | ❌ Not deployed | ❌ | ❌ | ❌ |

### CloudWatch Log Groups (DEV)

| Log Group | Service | Notes |
|-----------|---------|-------|
| `/ecs/market-maker-dev` | Market Maker ECS | Trading bot logs |
| `/ecs/futures-notifications-dev` | Notifications ECS | Telegram/HTTP logs |
| `/aws/lambda/margin-call-v2-dev` | Margin Call Lambda | Position checks |
| `bedrock-futures-marketplace-ecs-cluster-dev` | ECS Cluster | Cluster-level logs |

### Existing Alarms (To Be Consolidated)

Currently defined in `07_margin_call_lambda.tf`:
- `margin-call-lambda-errors-v2-{env}`
- `margin-call-lambda-duration-v2-{env}`

**Action**: Move these to new `80_alarms.tf` for consistency.

---

## Notification Strategy

### Two-Tier Alarm Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    COMPOSITE ALARMS (Layer 2)                    │
│  • Aggregate component states                                    │
│  • ONLY these send SNS notifications (when enabled)              │
│  • Human-actionable: "Futures UI is unhealthy"                   │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ monitors state of
┌──────────────────────────────────────────────────────────────────┐
│                    COMPONENT ALARMS (Layer 1)                    │
│  • Individual metric thresholds                                  │
│  • NO notifications (alarm_actions = [])                         │
│  • Visible in CloudWatch console for investigation               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Proposed Metric Filters (8 Critical)

### Market Maker Service (2 filters)

| # | Filter Name | Pattern | Metric Name | Description |
|---|-------------|---------|-------------|-------------|
| 1 | `mm_transaction_failed` | `Transaction failed` | `market_maker/tx_failures` | On-chain tx failure |
| 2 | `mm_insufficient_balance` | `Insufficient` | `market_maker/insufficient_balance` | Low funds warning |

### Margin Call Lambda (3 filters)

| # | Filter Name | Pattern | Metric Name | Description |
|---|-------------|---------|-------------|-------------|
| 3 | `margin_participants_checked` | `Found * participants` | `margin_call/participants_checked` | Participants per run |
| 4 | `margin_call_triggered` | `Sending margin call` | `margin_call/calls_triggered` | Margin calls sent |
| 5 | `margin_high_utilization` | `margin utilization ratio` | `margin_call/high_utilization` | Near-margin positions |

### Notifications Service (3 filters)

| # | Filter Name | Pattern | Metric Name | Description |
|---|-------------|---------|-------------|-------------|
| 6 | `notifications_errors` | `"level":50` | `notifications/errors` | Application errors |
| 7 | `notifications_slow_requests` | `responseTime":[0-9]{4,}` | `notifications/slow_requests` | Requests >1000ms |
| 8 | `notifications_server_restart` | `Server is listening on` | `notifications/restarts` | Service restarts |

---

## Proposed Component Alarms (17 Alarms)

### Futures UI / CloudFront (3 alarms) - NEW

| Alarm | Metric | Namespace | Threshold | Notes |
|-------|--------|-----------|-----------|-------|
| `futures_ui_5xx_errors` | 5xxErrorRate | AWS/CloudFront | > 5% for 5 min | Server-side errors |
| `futures_ui_4xx_errors` | 4xxErrorRate | AWS/CloudFront | > 10% for 5 min | Client errors (could indicate missing content) |
| `futures_ui_no_requests` | Requests | AWS/CloudFront | < 1 for 15 min | Site may be completely down |

**Question**: Should we also add a CloudWatch Synthetics Canary for production to actually load the page and verify content? This provides better "user experience" monitoring but adds complexity.

### Market Maker ECS (3 alarms)

| Alarm | Metric | Threshold | Composite Group |
|-------|--------|-----------|-----------------|
| `mm_ecs_cpu_high` | CpuUtilized % | > 90% for 5 min | Market Maker |
| `mm_ecs_memory_high` | MemoryUtilized % | > 90% for 5 min | Market Maker |
| `mm_ecs_running_tasks` | RunningTaskCount | < 1 for 5 min | Market Maker |

### Notifications ECS (3 alarms)

| Alarm | Metric | Threshold | Composite Group |
|-------|--------|-----------|-----------------|
| `notifications_ecs_cpu_high` | CpuUtilized % | > 90% for 5 min | Notifications |
| `notifications_ecs_memory_high` | MemoryUtilized % | > 90% for 5 min | Notifications |
| `notifications_ecs_running_tasks` | RunningTaskCount | < 1 for 5 min | Notifications |

### Margin Call Lambda (3 alarms) - Consolidated from 07_margin_call_lambda.tf

| Alarm | Metric | Threshold | Composite Group |
|-------|--------|-----------|-----------------|
| `margin_call_errors` | Errors | > threshold in 5 min | Margin Call |
| `margin_call_duration` | Duration | > 80% of timeout | Margin Call |
| `margin_call_throttles` | Throttles | > threshold in 5 min | Margin Call |

### Notifications RDS (3 alarms)

| Alarm | Metric | Threshold | Composite Group |
|-------|--------|-----------|-----------------|
| `notifications_rds_cpu` | CPUUtilization | > 90% for 5 min | RDS |
| `notifications_rds_storage` | FreeStorageSpace | < threshold GB | RDS |
| `notifications_rds_connections` | DatabaseConnections | > threshold | RDS |

### Notifications ALB (2 alarms)

| Alarm | Metric | Threshold | Composite Group |
|-------|--------|-----------|-----------------|
| `notifications_alb_5xx` | HTTPCode_ELB_5XX_Count | > threshold in 5 min | Notifications |
| `notifications_alb_unhealthy` | UnHealthyHostCount | > 0 for 2 min | Notifications |

---

## Proposed Composite Alarms (5 Alarms)

| Composite Alarm | Components | Description |
|-----------------|------------|-------------|
| `futures_ui_unhealthy` | futures_ui_5xx + futures_ui_4xx + futures_ui_no_requests | **Static UI is down or erroring** |
| `market_maker_unhealthy` | mm_ecs_* + mm_metric_filter alarms | Market Maker service is down |
| `margin_call_unhealthy` | margin_call_* alarms | Margin monitoring is failing |
| `notifications_unhealthy` | notifications_ecs_* + alb_* alarms | Notifications service is down |
| `rds_unhealthy` | notifications_rds_* alarms | Database issues |

---

## Dashboard Widgets

### Row 1: Futures UI (CloudFront)
- Request Count
- 4xx / 5xx Error Rates
- Bytes Downloaded
- Cache Hit Rate (if available)

### Row 2: Market Maker
- ECS Running Tasks
- CPU & Memory Utilization
- Transaction Failures (from metric filter)
- Insufficient Balance Events (from metric filter)

### Row 3: Margin Call Lambda
- Invocations & Errors
- Duration (with timeout line at 80%)
- Participants Checked (from metric filter)
- Margin Calls Triggered (from metric filter)

### Row 4: Notifications Service
- ECS Running Tasks + CPU/Memory
- ALB Request Count
- ALB Latency (p50, p95, p99)
- 5XX Error Count

### Row 5: RDS PostgreSQL
- CPU Utilization
- Free Storage Space
- Database Connections
- Read/Write IOPS

---

## File Structure

```
.terragrunt/
├── 70_monitoring_common.tf     # Locals, data sources, IAM for monitoring
├── 71_metric_filters.tf        # 8 CloudWatch Log Metric Filters
├── 80_alarms.tf                # 17 Component CloudWatch Alarms
├── 81_composite_alarms.tf      # 5 Composite Alarms (send notifications)
└── 89_dashboards.tf            # CloudWatch Dashboard
```

**Note**: Remove existing alarms from `07_margin_call_lambda.tf` after migration.

---

## Variable Structure

### 00_variables.tf Additions

```hcl
variable "monitoring" {
  description = "Monitoring configuration for alarms, dashboards, and metric filters"
  type = object({
    create                    = bool
    create_alarms             = bool
    create_dashboards         = bool
    create_metric_filters     = bool
    notifications_enabled     = bool    # Set false to disable SNS notifications
    dev_alerts_topic_name     = string  # Slack notifications
    devops_alerts_topic_name  = string  # Cell phone (critical, prod only)
    dashboard_period          = number
  })
  default = {
    create                    = false
    create_alarms             = false
    create_dashboards         = false
    create_metric_filters     = false
    notifications_enabled     = false
    dev_alerts_topic_name     = ""
    devops_alerts_topic_name  = ""
    dashboard_period          = 300
  }
}

variable "alarm_thresholds" {
  description = "Environment-specific alarm thresholds (relaxed for dev/stg, strict for prod)"
  type = object({
    ecs_cpu_threshold           = number
    ecs_memory_threshold        = number
    ecs_min_running_tasks       = number
    lambda_error_threshold      = number
    lambda_duration_threshold   = number
    lambda_throttle_threshold   = number
    alb_5xx_threshold           = number
    alb_unhealthy_threshold     = number
    alb_latency_threshold       = number
    rds_cpu_threshold           = number
    rds_storage_threshold       = number
    rds_connections_threshold   = number
    cloudfront_5xx_threshold    = number  # Percentage
    cloudfront_4xx_threshold    = number  # Percentage
  })
  default = {
    ecs_cpu_threshold           = 90
    ecs_memory_threshold        = 90
    ecs_min_running_tasks       = 1
    lambda_error_threshold      = 5
    lambda_duration_threshold   = 240000  # 80% of 300s timeout
    lambda_throttle_threshold   = 10
    alb_5xx_threshold           = 20
    alb_unhealthy_threshold     = 1
    alb_latency_threshold       = 15
    rds_cpu_threshold           = 90
    rds_storage_threshold       = 5
    rds_connections_threshold   = 90
    cloudfront_5xx_threshold    = 5
    cloudfront_4xx_threshold    = 10
  }
}
```

### terraform.tfvars Examples

**DEV (Relaxed, Notifications Disabled):**
```hcl
monitoring = {
  create                    = true
  create_alarms             = true
  create_dashboards         = true
  create_metric_filters     = true
  notifications_enabled     = false  # Disabled to reduce noise in dev
  dev_alerts_topic_name     = "titanio-dev-dev-alerts"
  devops_alerts_topic_name  = "titanio-dev-dev-alerts"
  dashboard_period          = 300
}

alarm_thresholds = {
  ecs_cpu_threshold           = 90
  ecs_memory_threshold        = 90
  ecs_min_running_tasks       = 1
  lambda_error_threshold      = 5
  lambda_duration_threshold   = 240000
  lambda_throttle_threshold   = 10
  alb_5xx_threshold           = 20
  alb_unhealthy_threshold     = 1
  alb_latency_threshold       = 15
  rds_cpu_threshold           = 90
  rds_storage_threshold       = 5
  rds_connections_threshold   = 90
  cloudfront_5xx_threshold    = 5
  cloudfront_4xx_threshold    = 10
}
```

**STG/LMN (Disabled - No Services Deployed):**
```hcl
monitoring = {
  create                    = false
  create_alarms             = false
  create_dashboards         = false
  create_metric_filters     = false
  notifications_enabled     = false
  dev_alerts_topic_name     = "titanio-{env}-dev-alerts"
  devops_alerts_topic_name  = "titanio-{env}-devops-alerts"
  dashboard_period          = 300
}

# alarm_thresholds can be omitted or set to defaults when create = false
```

---

## CloudFront Monitoring Decision

**Decision**: Option A (CloudFront metrics) for DEV/STG + Option B (Synthetics Canary) for LMN/Production

| Environment | CloudFront Metrics | Synthetics Canary |
|-------------|-------------------|-------------------|
| DEV | ✅ Yes | ❌ No |
| STG | ✅ Yes | ❌ No |
| LMN | ✅ Yes | ✅ Yes |

**Rationale**: Production (LMN) gets the additional Synthetics Canary to actually load the page and verify it renders correctly. DEV/STG use CloudFront metrics only to reduce cost and complexity.

### Synthetics Canary Details (LMN Only)
- **Runtime**: `syn-nodejs-puppeteer-9.1` (latest)
- **Frequency**: Every 5 minutes
- **Check**: Load `futures.lumerin.io`, verify HTTP 200 and page content
- **Cost**: ~$0.0012/run × 288 runs/day = ~$0.35/day

---

## Action Items

### Phase 1: Create Terraform Files
1. [ ] Add `monitoring` and `alarm_thresholds` variables to `00_variables.tf`
2. [ ] Create `70_monitoring_common.tf` (locals, data sources, IAM)
3. [ ] Create `71_metric_filters.tf` (8 log metric filters)
4. [ ] Create `80_alarms.tf` (17 component alarms)
5. [ ] Create `81_composite_alarms.tf` (5 composite alarms)
6. [ ] Create `89_dashboards.tf` (comprehensive dashboard)
7. [ ] Remove existing alarms from `07_margin_call_lambda.tf`

### Phase 2: Update Environment tfvars
8. [ ] Update `02-dev/terraform.tfvars` with monitoring config (create = true)
9. [ ] Update `03-stg/terraform.tfvars` with monitoring config (create = false)
10. [ ] Update `04-lmn/terraform.tfvars` with monitoring config (create = false)

### Phase 3: Plan and Review
11. [ ] Run `tgplan` in 02-dev environment
12. [ ] Fix any planning issues
13. [ ] Report results for review

### Important Notes
- **DO NOT** apply changes without explicit approval
- **DO NOT** commit files to repository
- Services only exist in DEV environment currently
- Oracle Lambda monitoring is handled in hashprice-oracle repo (separate)
- Wallet balance monitoring will be centralized elsewhere (separate project)

---

*Document Version: 1.1*
*Created: 2026-01-24*
*Repository: futures-marketplace*
