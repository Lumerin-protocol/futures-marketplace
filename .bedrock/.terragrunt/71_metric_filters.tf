################################################################################
# CLOUDWATCH LOG METRIC FILTERS
# 5 Critical Metric Filters for Futures Marketplace
################################################################################

################################################################################
# MARKET MAKER SERVICE FILTERS (2)
################################################################################

# Filter 1: Transaction failures
resource "aws_cloudwatch_log_metric_filter" "mm_transaction_failed" {
  count          = var.monitoring.create && var.monitoring.create_metric_filters && var.market_maker.create ? 1 : 0
  name           = "market-maker-tx-failed-${local.env_suffix}"
  pattern        = "Transaction failed"
  log_group_name = local.market_maker_log_group

  metric_transformation {
    name          = "TransactionFailures"
    namespace     = local.monitoring_namespace
    value         = "1"
    default_value = "0"
  }
}

# Filter 2: Insufficient balance warnings
resource "aws_cloudwatch_log_metric_filter" "mm_insufficient_balance" {
  count          = var.monitoring.create && var.monitoring.create_metric_filters && var.market_maker.create ? 1 : 0
  name           = "market-maker-insufficient-balance-${local.env_suffix}"
  pattern        = "Insufficient"
  log_group_name = local.market_maker_log_group

  metric_transformation {
    name          = "InsufficientBalance"
    namespace     = local.monitoring_namespace
    value         = "1"
    default_value = "0"
  }
}

################################################################################
# NOTIFICATIONS SERVICE FILTERS (3)
################################################################################

# Filter 3: Application errors (Pino level 50)
resource "aws_cloudwatch_log_metric_filter" "notifications_errors" {
  count          = var.monitoring.create && var.monitoring.create_metric_filters && var.notifications_service.create ? 1 : 0
  name           = "notifications-errors-${local.env_suffix}"
  pattern        = "{ $.level = 50 }"
  log_group_name = local.notifications_log_group

  metric_transformation {
    name          = "NotificationsErrors"
    namespace     = local.monitoring_namespace
    value         = "1"
    default_value = "0"
  }
}

# Filter 4: Slow requests (responseTime > 1000ms)
resource "aws_cloudwatch_log_metric_filter" "notifications_slow_requests" {
  count          = var.monitoring.create && var.monitoring.create_metric_filters && var.notifications_service.create ? 1 : 0
  name           = "notifications-slow-requests-${local.env_suffix}"
  pattern        = "{ $.responseTime > 1000 }"
  log_group_name = local.notifications_log_group

  metric_transformation {
    name          = "SlowRequests"
    namespace     = local.monitoring_namespace
    value         = "1"
    default_value = "0"
  }
}

# Filter 5: Service restarts
resource "aws_cloudwatch_log_metric_filter" "notifications_restarts" {
  count          = var.monitoring.create && var.monitoring.create_metric_filters && var.notifications_service.create ? 1 : 0
  name           = "notifications-restarts-${local.env_suffix}"
  pattern        = "Server is listening on"
  log_group_name = local.notifications_log_group

  metric_transformation {
    name          = "ServiceRestarts"
    namespace     = local.monitoring_namespace
    value         = "1"
    default_value = "0"
  }
}
