################################################################################
# COMPONENT CLOUDWATCH ALARMS
# 17 Component Alarms for Futures Marketplace
# Note: These alarms do NOT send notifications - they feed into composite alarms
################################################################################

################################################################################
# FUTURES UI / CLOUDFRONT ALARMS (3)
################################################################################

# CloudFront 5xx Error Rate
resource "aws_cloudwatch_metric_alarm" "futures_ui_5xx" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.create_core ? 1 : 0
  alarm_name          = "futures-ui-5xx-errors-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.cloudfront_5xx_threshold
  alarm_description   = "Futures UI CloudFront 5xx errors for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} minutes"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = local.cloudfront_distribution_id
    Region         = "Global"
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures UI 5xx Errors Alarm",
      Capability = "Monitoring",
    },
  )
}

# CloudFront 4xx Error Rate
resource "aws_cloudwatch_metric_alarm" "futures_ui_4xx" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.create_core ? 1 : 0
  alarm_name          = "futures-ui-4xx-errors-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "4xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.cloudfront_4xx_threshold
  alarm_description   = "Futures UI CloudFront 4xx errors for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} minutes"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = local.cloudfront_distribution_id
    Region         = "Global"
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures UI 4xx Errors Alarm",
      Capability = "Monitoring",
    },
  )
}

# Route53 Health Check - Site Unreachable
# Uses Route53 health check (probes every 30s) instead of CloudFront request count
# This works correctly for low-traffic sites (dev/stg) where no user traffic is normal
resource "aws_cloudwatch_metric_alarm" "futures_ui_unreachable" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.create_core ? 1 : 0
  provider            = aws.use1  # Route53 metrics are only in us-east-1
  alarm_name          = "futures-ui-unreachable-${local.env_suffix}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = local.route53_alarm_evaluation_periods  # unhealthy_alarm_period (1 min periods)
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Futures UI unreachable for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} minutes"
  treat_missing_data  = "breaching"

  dimensions = {
    HealthCheckId = aws_route53_health_check.futures_ui[0].id
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures UI Unreachable Alarm",
      Capability = "Monitoring",
    },
  )
}

################################################################################
# MARKET MAKER LAMBDA ALARMS (3)
################################################################################

# Market Maker Lambda Errors
resource "aws_cloudwatch_metric_alarm" "mm_lambda_errors" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.market_maker.create ? 1 : 0
  alarm_name          = "market-maker-errors-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.alarm_thresholds.lambda_error_threshold
  alarm_description   = "Market Maker Lambda errors for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = local.market_maker_function_name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Errors Alarm",
      Capability = "Monitoring",
    },
  )
}

# Market Maker Lambda Duration
resource "aws_cloudwatch_metric_alarm" "mm_lambda_duration" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.market_maker.create ? 1 : 0
  alarm_name          = "market-maker-duration-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.lambda_duration_threshold
  alarm_description   = "Market Maker Lambda duration high for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = local.market_maker_function_name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Duration Alarm",
      Capability = "Monitoring",
    },
  )
}

# Market Maker Lambda Throttles
resource "aws_cloudwatch_metric_alarm" "mm_lambda_throttles" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.market_maker.create ? 1 : 0
  alarm_name          = "market-maker-throttles-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.alarm_thresholds.lambda_throttle_threshold
  alarm_description   = "Market Maker Lambda throttled for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = local.market_maker_function_name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Throttles Alarm",
      Capability = "Monitoring",
    },
  )
}

# Market Maker Insufficient Funds - DIRECT ALERT (not composite)
# This is an operational issue requiring immediate attention
resource "aws_cloudwatch_metric_alarm" "mm_insufficient_funds" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.market_maker.create ? 1 : 0
  alarm_name          = "market-maker-insufficient-funds-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1  # Alert immediately on first occurrence
  metric_name         = "InsufficientBalance"
  namespace           = local.monitoring_namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Market Maker has insufficient ETH or USDC - needs wallet funding"
  treat_missing_data  = "notBreaching"

  # Direct alert - bypasses composite alarm
  alarm_actions = local.composite_alarm_actions
  ok_actions    = local.composite_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Insufficient Funds Alarm",
      Capability = "Monitoring",
    },
  )
}

################################################################################
# NOTIFICATIONS ECS ALARMS (3)
################################################################################

# Notifications CPU High (using metric math for percentage)
resource "aws_cloudwatch_metric_alarm" "notifications_ecs_cpu_high" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name          = "notifications-cpu-high-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  threshold           = var.alarm_thresholds.ecs_cpu_threshold
  alarm_description   = "Notifications CPU >${var.alarm_thresholds.ecs_cpu_threshold}% for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "cpu_percent"
    expression  = "(cpu_used / cpu_reserved) * 100"
    label       = "CPU Utilization %"
    return_data = true
  }

  metric_query {
    id = "cpu_used"
    metric {
      metric_name = "CpuUtilized"
      namespace   = "ECS/ContainerInsights"
      period      = 300
      stat        = "Average"
      dimensions = {
        ClusterName = local.ecs_cluster_name
        ServiceName = local.notifications_service_name
      }
    }
  }

  metric_query {
    id = "cpu_reserved"
    metric {
      metric_name = "CpuReserved"
      namespace   = "ECS/ContainerInsights"
      period      = 300
      stat        = "Average"
      dimensions = {
        ClusterName = local.ecs_cluster_name
        ServiceName = local.notifications_service_name
      }
    }
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications CPU High Alarm",
      Capability = "Monitoring",
    },
  )
}

# Notifications Memory High (using metric math for percentage)
resource "aws_cloudwatch_metric_alarm" "notifications_ecs_memory_high" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name          = "notifications-memory-high-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  threshold           = var.alarm_thresholds.ecs_memory_threshold
  alarm_description   = "Notifications Memory >${var.alarm_thresholds.ecs_memory_threshold}% for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "mem_percent"
    expression  = "(mem_used / mem_reserved) * 100"
    label       = "Memory Utilization %"
    return_data = true
  }

  metric_query {
    id = "mem_used"
    metric {
      metric_name = "MemoryUtilized"
      namespace   = "ECS/ContainerInsights"
      period      = 300
      stat        = "Average"
      dimensions = {
        ClusterName = local.ecs_cluster_name
        ServiceName = local.notifications_service_name
      }
    }
  }

  metric_query {
    id = "mem_reserved"
    metric {
      metric_name = "MemoryReserved"
      namespace   = "ECS/ContainerInsights"
      period      = 300
      stat        = "Average"
      dimensions = {
        ClusterName = local.ecs_cluster_name
        ServiceName = local.notifications_service_name
      }
    }
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications Memory High Alarm",
      Capability = "Monitoring",
    },
  )
}

# Notifications Running Tasks
resource "aws_cloudwatch_metric_alarm" "notifications_ecs_running_tasks" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name          = "notifications-running-tasks-${local.env_suffix}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.ecs_min_running_tasks
  alarm_description   = "Notifications down for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = local.ecs_cluster_name
    ServiceName = local.notifications_service_name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications Running Tasks Alarm",
      Capability = "Monitoring",
    },
  )
}

################################################################################
# MARGIN CALL LAMBDA ALARMS (3)
# Note: Consolidated from 07_margin_call_lambda.tf
################################################################################

# Margin Call Errors
resource "aws_cloudwatch_metric_alarm" "margin_call_errors" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.margin_call_lambda.create ? 1 : 0
  alarm_name          = "margin-call-errors-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.alarm_thresholds.lambda_error_threshold
  alarm_description   = "Margin Call errors for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = local.margin_call_function_name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Errors Alarm",
      Capability = "Monitoring",
    },
  )
}

# Margin Call Duration
resource "aws_cloudwatch_metric_alarm" "margin_call_duration" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.margin_call_lambda.create ? 1 : 0
  alarm_name          = "margin-call-duration-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.lambda_duration_threshold
  alarm_description   = "Margin Call duration high for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = local.margin_call_function_name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Duration Alarm",
      Capability = "Monitoring",
    },
  )
}

# Margin Call Throttles
resource "aws_cloudwatch_metric_alarm" "margin_call_throttles" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.margin_call_lambda.create ? 1 : 0
  alarm_name          = "margin-call-throttles-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.alarm_thresholds.lambda_throttle_threshold
  alarm_description   = "Margin Call throttled for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = local.margin_call_function_name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Throttles Alarm",
      Capability = "Monitoring",
    },
  )
}

################################################################################
# NOTIFICATIONS RDS ALARMS (3)
################################################################################

# RDS CPU High
resource "aws_cloudwatch_metric_alarm" "notifications_rds_cpu" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name          = "notifications-rds-cpu-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.rds_cpu_threshold
  alarm_description   = "Notifications RDS CPU high for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = local.notifications_rds_identifier
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications RDS CPU Alarm",
      Capability = "Monitoring",
    },
  )
}

# RDS Storage Low
resource "aws_cloudwatch_metric_alarm" "notifications_rds_storage" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name          = "notifications-rds-storage-${local.env_suffix}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.rds_storage_threshold * 1024 * 1024 * 1024  # Convert GB to bytes
  alarm_description   = "Notifications RDS storage low for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = local.notifications_rds_identifier
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications RDS Storage Alarm",
      Capability = "Monitoring",
    },
  )
}

# RDS Connections High
resource "aws_cloudwatch_metric_alarm" "notifications_rds_connections" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name          = "notifications-rds-connections-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.rds_connections_threshold
  alarm_description   = "Notifications RDS connections high for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = local.notifications_rds_identifier
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications RDS Connections Alarm",
      Capability = "Monitoring",
    },
  )
}

################################################################################
# NOTIFICATIONS ALB ALARMS (2)
################################################################################

# ALB 5xx Errors
resource "aws_cloudwatch_metric_alarm" "notifications_alb_5xx" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name          = "notifications-alb-5xx-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.standard_alarm_evaluation_periods
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = var.alarm_thresholds.alb_5xx_threshold
  alarm_description   = "Notifications ALB 5xx errors for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = local.notifications_alb_arn_suffix
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications ALB 5xx Alarm",
      Capability = "Monitoring",
    },
  )
}

# ALB Unhealthy Hosts
resource "aws_cloudwatch_metric_alarm" "notifications_alb_unhealthy" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.notifications_service.create ? 1 : 0
  alarm_name          = "notifications-alb-unhealthy-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.route53_alarm_evaluation_periods  # period = 60 sec
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = var.alarm_thresholds.alb_unhealthy_threshold
  alarm_description   = "Notifications ALB unhealthy for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = local.notifications_alb_arn_suffix
    TargetGroup  = local.notifications_tg_arn_suffix
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications ALB Unhealthy Alarm",
      Capability = "Monitoring",
    },
  )
}
