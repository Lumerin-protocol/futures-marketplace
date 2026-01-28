variable "create_core" {
  description = "Decide whether or not to create the core resources"
  type        = bool
  default     = false
}

variable "ecs_cluster" {
  description = "ECS Cluster Variables"
  type    = map(any)
  default = {}
}

variable "market_maker" {
  description = "Market Maker Service Variables"
  type    = map(any)
  default = {}
}

variable "market_maker_private_key" {
  description = "Private key for the market maker"
  type        = string
  sensitive   = true
  default     = ""
}

variable "market_maker_eth_node_url" {
  description = "ETH Node URL for the market maker"
  type        = string
  default     = ""
}

variable "margin_call_lambda" {
  description = "Margin Call Lambda Service Variables"
  type    = map(any)
  default = {}
}

variable "notifications_service" {
  description = "Notifications Service Variables"
  type    = map(any)
  default = {}
}

variable "telegram_bot_token" {
  description = "Telegram Bot Token for Notifications service"
  type        = string
  sensitive   = true
  default     = ""
}

################################################################################
# SHARED INFRASTRUCTURE (used across multiple services)
################################################################################

variable "ethereum_rpc_url" {
  description = "Ethereum RPC URL (used by oracle lambda, indexer, and margin call)"
  type        = string
  sensitive   = true
  default     = ""
}

################################################################################
# THE GRAPH NETWORK CONFIGURATION
# API key and subgraph IDs for querying published subgraphs
################################################################################

variable "graph_api_key" {
  description = "The Graph API Key for accessing published subgraphs"
  type        = string
  sensitive   = true
  default     = ""
}

variable "futures_subgraph_id" {
  description = "The Graph Subgraph ID for Futures (from published subgraph)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "oracles_subgraph_id" {
  description = "The Graph Subgraph ID for Oracles (from published subgraph)"
  type        = string
  sensitive   = true
  default     = ""
}

################################################################################
# SHARED CONTRACT ADDRESSES (used across multiple services)
################################################################################

variable "clone_factory_address" {
  description = "Clone Factory contract address (used by indexer)"
  type        = string
  default     = ""
}

variable "hashrate_oracle_address" {
  description = "Hashrate Oracle contract address (used by oracle lambda, indexer, and margin call)"
  type        = string
  default     = ""
}

variable "futures_address" {
  description = "Futures Marketplace contract address (used by margin call lambda)"
  type        = string
  default     = ""
}

variable "multicall_address" {
  description = "Multicall3 contract address (same address on all EVM chains)"
  type        = string
  default     = ""
}


################################################################################
# MONITORING CONFIGURATION
################################################################################

variable "monitoring" {
  description = "Monitoring configuration for alarms, dashboards, and metric filters"
  type = object({
    create                    = bool
    create_alarms             = bool
    create_dashboards         = bool
    create_metric_filters     = bool
    create_synthetics_canary  = bool     # Synthetics canary for UI (production only)
    notifications_enabled     = bool     # Set false to disable SNS notifications (alarms still visible in console)
    dev_alerts_topic_name     = string   # Slack notifications
    devops_alerts_topic_name  = string   # Cell phone (critical, prod only)
    dashboard_period          = number
  })
  default = {
    create                    = false
    create_alarms             = false
    create_dashboards         = false
    create_metric_filters     = false
    create_synthetics_canary  = false
    notifications_enabled     = false
    dev_alerts_topic_name     = ""
    devops_alerts_topic_name  = ""
    dashboard_period          = 300
  }
}

variable "monitoring_schedule" {
  description = "Schedule rates for monitoring resources and alarm timing"
  type = object({
    synthetics_canary_rate_minutes = number  # How often to run canary (5-60)
    unhealthy_alarm_period_minutes = number  # How long to tolerate "bad" before alarm triggers
  })
  default = {
    synthetics_canary_rate_minutes = 15
    unhealthy_alarm_period_minutes = 15
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
}

# Common Account Variables
variable "account_shortname" { description = "Code describing customer  and lifecycle. E.g., mst, sbx, dev, stg, prd" }
variable "account_lifecycle" {
  description = "environment lifecycle, can be 'prod', 'nonprod', 'sandbox'...dev and stg are considered nonprod"
  type        = string
}
variable "account_number" {}
variable "default_region" {}
variable "region_shortname" {
  description = "Region 4 character shortname"
  default     = "use1"
}
variable "vpc_index" {}
variable "devops_keypair" {}
variable "titanio_net_edge_vpn" {}
variable "protect_environment" {}
variable "ecs_task_role_arn" {}
variable "default_tags" {
  description = "Default tag values common across all resources in this account. Values can be overridden when configuring a resource or module."
  type        = map(string)
}
variable "foundation_tags" {
  description = "Default Tags for Bedrock Foundation resources"
  type        = map(string)
}
variable "provider_profile" {
  description = "Provider config added for use in aws_config.tf"
}
