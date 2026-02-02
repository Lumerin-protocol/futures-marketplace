################################################################################
# CLOUDWATCH DASHBOARD
# Comprehensive monitoring dashboard for Futures Marketplace
################################################################################

resource "aws_cloudwatch_dashboard" "futures_marketplace" {
  count          = var.monitoring.create && var.monitoring.create_dashboards ? 1 : 0
  dashboard_name = "01-FuturesMarketplace-${local.env_suffix}"

  dashboard_body = jsonencode({
    widgets = [
      # Row 1: Futures UI / CloudFront (always present since create_core = true in DEV)
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 6
        height = 6
        properties = {
          title  = "Futures UI - Request Count"
          region = var.default_region
          stat   = "Sum"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", local.cloudfront_distribution_id, "Region", "Global"]
          ]
        }
      },
      {
        type   = "metric"
        x      = 6
        y      = 0
        width  = 6
        height = 6
        properties = {
          title  = "Futures UI - Error Rates"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/CloudFront", "4xxErrorRate", "DistributionId", local.cloudfront_distribution_id, "Region", "Global", { label = "4xx Error Rate" }],
            [".", "5xxErrorRate", ".", ".", ".", ".", { label = "5xx Error Rate" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 6
        height = 6
        properties = {
          title  = "Futures UI - Bytes Transferred"
          region = var.default_region
          stat   = "Sum"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/CloudFront", "BytesDownloaded", "DistributionId", local.cloudfront_distribution_id, "Region", "Global", { label = "Downloaded" }],
            [".", "BytesUploaded", ".", ".", ".", ".", { label = "Uploaded" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 0
        width  = 6
        height = 3
        properties = {
          title  = "Futures UI - Canary Success"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          view   = "singleValue"
          metrics = var.monitoring.create_synthetics_canary ? [
            ["CloudWatchSynthetics", "SuccessPercent", "CanaryName", "futures-ui-${local.env_suffix}", { label = "Success %" }]
          ] : []
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 3
        width  = 6
        height = 3
        properties = {
          title  = "Futures UI - Canary Duration"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = var.monitoring.create_synthetics_canary ? [
            ["CloudWatchSynthetics", "Duration", "CanaryName", "futures-ui-${local.env_suffix}", { label = "Duration (ms)" }]
          ] : []
        }
      },

      # Row 2: Market Maker Lambda
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 6
        height = 6
        properties = {
          title  = "Market Maker - Invocations & Errors"
          region = var.default_region
          stat   = "Sum"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", local.market_maker_function_name, { label = "Invocations" }],
            [".", "Errors", ".", ".", { label = "Errors", color = "#ff0000" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 6
        y      = 6
        width  = 6
        height = 6
        properties = {
          title  = "Market Maker - Duration"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", local.market_maker_function_name, { label = "Duration (ms)" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 6
        height = 6
        properties = {
          title  = "Market Maker - Concurrent Executions"
          region = var.default_region
          stat   = "Maximum"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", local.market_maker_function_name, { label = "Concurrent" }],
            [".", "Throttles", ".", ".", { label = "Throttles", color = "#ff9900" }]
          ]
        }
      },
      {
        type   = "text"
        x      = 18
        y      = 6
        width  = 6
        height = 6
        properties = {
          markdown = "## Market Maker Status\n\n**Lambda**: ${local.market_maker_function_name}\n\n**Schedule**: Every 1 minute\n\n**Composite Alarm**: `market-maker-${local.env_suffix}`\n\n---\n*Automated trading bot for Futures Marketplace*"
        }
      },

      # Row 3: Margin Call Lambda
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 6
        height = 6
        properties = {
          title  = "Margin Call - Invocations & Errors"
          region = var.default_region
          stat   = "Sum"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", local.margin_call_function_name, { label = "Invocations" }],
            [".", "Errors", ".", ".", { label = "Errors", color = "#ff0000" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 6
        y      = 12
        width  = 6
        height = 6
        properties = {
          title  = "Margin Call - Duration"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", local.margin_call_function_name]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 6
        height = 6
        properties = {
          title  = "Margin Call - Business Metrics"
          region = var.default_region
          stat   = "Sum"
          period = var.monitoring.dashboard_period
          metrics = [
            [local.monitoring_namespace, "ParticipantsChecked", { label = "Participants Checked" }],
            [".", "MarginCallsTriggered", { label = "Margin Calls Triggered", color = "#ff9900" }],
            [".", "HighMarginUtilization", { label = "High Utilization Events" }]
          ]
        }
      },
      {
        type   = "text"
        x      = 18
        y      = 12
        width  = 6
        height = 6
        properties = {
          markdown = "## Margin Call Status\n\n**Function**: ${local.margin_call_function_name}\n\n**Schedule**: Every 15 minutes\n\n**Composite Alarm**: `margin-call-unhealthy-${local.env_suffix}`\n\n---\n*Monitors participant positions and triggers margin calls*"
        }
      },

      # Row 4: Notifications Service
      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 6
        height = 6
        properties = {
          title  = "Notifications - Running Tasks"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", local.ecs_cluster_name, "ServiceName", local.notifications_service_name]
          ]
        }
      },
      {
        type   = "metric"
        x      = 6
        y      = 18
        width  = 6
        height = 6
        properties = {
          title  = "Notifications - CPU & Memory"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["ECS/ContainerInsights", "CpuUtilized", "ClusterName", local.ecs_cluster_name, "ServiceName", local.notifications_service_name, { label = "CPU %" }],
            [".", "MemoryUtilized", ".", ".", ".", ".", { label = "Memory %" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 18
        width  = 6
        height = 6
        properties = {
          title  = "Notifications ALB - Requests & Errors"
          region = var.default_region
          stat   = "Sum"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", local.notifications_alb_arn_suffix, { label = "Requests" }],
            [".", "HTTPCode_ELB_5XX_Count", ".", ".", { label = "5xx Errors", color = "#ff0000" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 18
        width  = 6
        height = 6
        properties = {
          title  = "Notifications ALB - Latency"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", local.notifications_alb_arn_suffix, { label = "Avg Latency" }]
          ]
        }
      },

      # Row 5: RDS PostgreSQL
      {
        type   = "metric"
        x      = 0
        y      = 24
        width  = 6
        height = 6
        properties = {
          title  = "RDS - CPU Utilization"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", local.notifications_rds_identifier]
          ]
        }
      },
      {
        type   = "metric"
        x      = 6
        y      = 24
        width  = 6
        height = 6
        properties = {
          title  = "RDS - Free Storage Space"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", local.notifications_rds_identifier]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 24
        width  = 6
        height = 6
        properties = {
          title  = "RDS - Database Connections"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", local.notifications_rds_identifier]
          ]
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 24
        width  = 6
        height = 6
        properties = {
          title  = "RDS - IOPS"
          region = var.default_region
          stat   = "Average"
          period = var.monitoring.dashboard_period
          metrics = [
            ["AWS/RDS", "ReadIOPS", "DBInstanceIdentifier", local.notifications_rds_identifier, { label = "Read IOPS" }],
            [".", "WriteIOPS", ".", ".", { label = "Write IOPS" }]
          ]
        }
      }
    ]
  })
}
