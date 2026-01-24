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
  evaluation_periods  = 2
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.cloudfront_5xx_threshold
  alarm_description   = "Futures UI CloudFront 5xx error rate is elevated"
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
  evaluation_periods  = 2
  metric_name         = "4xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.cloudfront_4xx_threshold
  alarm_description   = "Futures UI CloudFront 4xx error rate is elevated - may indicate missing content"
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
  evaluation_periods  = 2
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Futures UI is unreachable - Route53 health check failing"
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
# MARKET MAKER ECS ALARMS (3)
################################################################################

# Market Maker CPU High (using metric math for percentage)
resource "aws_cloudwatch_metric_alarm" "mm_ecs_cpu_high" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.market_maker.create ? 1 : 0
  alarm_name          = "market-maker-cpu-high-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.alarm_thresholds.ecs_cpu_threshold
  alarm_description   = "Market Maker ECS CPU utilization is high (>${var.alarm_thresholds.ecs_cpu_threshold}%)"
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
        ServiceName = local.market_maker_service_name
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
        ServiceName = local.market_maker_service_name
      }
    }
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker CPU High Alarm",
      Capability = "Monitoring",
    },
  )
}

# Market Maker Memory High (using metric math for percentage)
resource "aws_cloudwatch_metric_alarm" "mm_ecs_memory_high" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.market_maker.create ? 1 : 0
  alarm_name          = "market-maker-memory-high-${local.env_suffix}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.alarm_thresholds.ecs_memory_threshold
  alarm_description   = "Market Maker ECS memory utilization is high (>${var.alarm_thresholds.ecs_memory_threshold}%)"
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
        ServiceName = local.market_maker_service_name
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
        ServiceName = local.market_maker_service_name
      }
    }
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Memory High Alarm",
      Capability = "Monitoring",
    },
  )
}

# Market Maker Running Tasks
resource "aws_cloudwatch_metric_alarm" "mm_ecs_running_tasks" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.market_maker.create ? 1 : 0
  alarm_name          = "market-maker-running-tasks-${local.env_suffix}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.ecs_min_running_tasks
  alarm_description   = "Market Maker has fewer than expected running tasks"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = local.ecs_cluster_name
    ServiceName = local.market_maker_service_name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Running Tasks Alarm",
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
  evaluation_periods  = 2
  threshold           = var.alarm_thresholds.ecs_cpu_threshold
  alarm_description   = "Notifications ECS CPU utilization is high (>${var.alarm_thresholds.ecs_cpu_threshold}%)"
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
  evaluation_periods  = 2
  threshold           = var.alarm_thresholds.ecs_memory_threshold
  alarm_description   = "Notifications ECS memory utilization is high (>${var.alarm_thresholds.ecs_memory_threshold}%)"
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
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.ecs_min_running_tasks
  alarm_description   = "Notifications service has fewer than expected running tasks"
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
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.alarm_thresholds.lambda_error_threshold
  alarm_description   = "Margin Call Lambda is experiencing errors"
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
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.lambda_duration_threshold
  alarm_description   = "Margin Call Lambda duration approaching timeout"
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
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.alarm_thresholds.lambda_throttle_threshold
  alarm_description   = "Margin Call Lambda is being throttled"
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
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.rds_cpu_threshold
  alarm_description   = "Notifications RDS CPU utilization is high"
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
  evaluation_periods  = 2
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.rds_storage_threshold * 1024 * 1024 * 1024  # Convert GB to bytes
  alarm_description   = "Notifications RDS free storage is low"
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
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.alarm_thresholds.rds_connections_threshold
  alarm_description   = "Notifications RDS connection count is high"
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
  evaluation_periods  = 2
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = var.alarm_thresholds.alb_5xx_threshold
  alarm_description   = "Notifications ALB is returning 5xx errors"
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
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = var.alarm_thresholds.alb_unhealthy_threshold
  alarm_description   = "Notifications ALB has unhealthy targets"
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
