################################################################################
# COMPOSITE CLOUDWATCH ALARMS
# 5 Composite Alarms for Futures Marketplace
# These are the ONLY alarms that send SNS notifications (when enabled)
################################################################################

################################################################################
# FUTURES UI UNHEALTHY
################################################################################

resource "aws_cloudwatch_composite_alarm" "futures_ui_unhealthy" {
  count             = var.monitoring.create && var.monitoring.create_alarms && var.create_core ? 1 : 0
  alarm_name        = "futures-ui-${local.env_suffix}"
  alarm_description = "Futures UI is unhealthy - Route53 health check failing, CloudFront errors, or canary failing (prod only)"

  # Alarm rule: ANY of the UI component alarms in ALARM state
  # - Route53 health check: baseline reachability (all envs)
  # - CloudFront 4xx/5xx: error rates when traffic exists
  # - Canary: browser-based testing (production only)
  alarm_rule = var.monitoring.create_synthetics_canary ? join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.futures_ui_unreachable[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.futures_ui_5xx[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.futures_ui_4xx[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.canary_failed[0].alarm_name})"
  ]) : join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.futures_ui_unreachable[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.futures_ui_5xx[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.futures_ui_4xx[0].alarm_name})"
  ])

  alarm_actions = local.composite_alarm_actions
  ok_actions    = local.composite_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures UI Unhealthy Composite Alarm",
      Capability = "Monitoring",
    },
  )

  # Include canary_failed in depends_on even when count=0
  # This ensures proper deletion order when canary is disabled
  depends_on = [
    aws_cloudwatch_metric_alarm.futures_ui_unreachable,
    aws_cloudwatch_metric_alarm.futures_ui_5xx,
    aws_cloudwatch_metric_alarm.futures_ui_4xx,
    aws_cloudwatch_metric_alarm.canary_failed
  ]
}

################################################################################
# MARKET MAKER UNHEALTHY
################################################################################

resource "aws_cloudwatch_composite_alarm" "market_maker_unhealthy" {
  count             = var.monitoring.create && var.monitoring.create_alarms && var.market_maker.create ? 1 : 0
  alarm_name        = "market-maker-${local.env_suffix}"
  alarm_description = "Market Maker Lambda is unhealthy - errors or throttling"

  # Alarm rule: ANY of the Market Maker Lambda component alarms in ALARM state
  alarm_rule = join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.mm_lambda_errors[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.mm_lambda_duration[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.mm_lambda_throttles[0].alarm_name})"
  ])

  alarm_actions = local.composite_alarm_actions
  ok_actions    = local.composite_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Unhealthy Composite Alarm",
      Capability = "Monitoring",
    },
  )

  depends_on = [
    aws_cloudwatch_metric_alarm.mm_lambda_errors,
    aws_cloudwatch_metric_alarm.mm_lambda_duration,
    aws_cloudwatch_metric_alarm.mm_lambda_throttles
  ]
}

################################################################################
# MARGIN CALL UNHEALTHY
################################################################################

resource "aws_cloudwatch_composite_alarm" "margin_call_unhealthy" {
  count             = var.monitoring.create && var.monitoring.create_alarms && var.margin_call_lambda.create ? 1 : 0
  alarm_name        = "margin-call-${local.env_suffix}"
  alarm_description = "Margin Call monitoring is failing - Lambda errors or throttling"

  # Alarm rule: ANY of the Margin Call component alarms in ALARM state
  alarm_rule = join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.margin_call_errors[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.margin_call_duration[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.margin_call_throttles[0].alarm_name})"
  ])

  alarm_actions = local.composite_alarm_actions
  ok_actions    = local.composite_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Unhealthy Composite Alarm",
      Capability = "Monitoring",
    },
  )

  depends_on = [
    aws_cloudwatch_metric_alarm.margin_call_errors,
    aws_cloudwatch_metric_alarm.margin_call_duration,
    aws_cloudwatch_metric_alarm.margin_call_throttles
  ]
}

################################################################################
# NOTIFICATIONS UNHEALTHY
################################################################################

resource "aws_cloudwatch_composite_alarm" "notifications_unhealthy" {
  count             = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name        = "notifications-${local.env_suffix}"
  alarm_description = "Notifications service is unhealthy - ECS or ALB issues"

  # Alarm rule: ANY of the Notifications component alarms in ALARM state
  alarm_rule = join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.notifications_ecs_cpu_high[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.notifications_ecs_memory_high[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.notifications_ecs_running_tasks[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.notifications_alb_5xx[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.notifications_alb_unhealthy[0].alarm_name})"
  ])

  alarm_actions = local.composite_alarm_actions
  ok_actions    = local.composite_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications Unhealthy Composite Alarm",
      Capability = "Monitoring",
    },
  )

  depends_on = [
    aws_cloudwatch_metric_alarm.notifications_ecs_cpu_high,
    aws_cloudwatch_metric_alarm.notifications_ecs_memory_high,
    aws_cloudwatch_metric_alarm.notifications_ecs_running_tasks,
    aws_cloudwatch_metric_alarm.notifications_alb_5xx,
    aws_cloudwatch_metric_alarm.notifications_alb_unhealthy
  ]
}

################################################################################
# RDS UNHEALTHY
################################################################################

resource "aws_cloudwatch_composite_alarm" "rds_unhealthy" {
  count             = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name        = "notificationsrds-${local.env_suffix}"
  alarm_description = "RDS PostgreSQL is unhealthy - CPU, storage, or connection issues"

  # Alarm rule: ANY of the RDS component alarms in ALARM state
  alarm_rule = join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.notifications_rds_cpu[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.notifications_rds_storage[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.notifications_rds_connections[0].alarm_name})"
  ])

  alarm_actions = local.composite_alarm_actions
  ok_actions    = local.composite_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications RDS Unhealthy Composite Alarm",
      Capability = "Monitoring",
    },
  )

  depends_on = [
    aws_cloudwatch_metric_alarm.notifications_rds_cpu,
    aws_cloudwatch_metric_alarm.notifications_rds_storage,
    aws_cloudwatch_metric_alarm.notifications_rds_connections
  ]
}
