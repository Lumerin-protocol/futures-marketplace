################################################################################
# MONITORING COMMON - Locals, Data Sources, IAM
################################################################################

locals {
  # Environment suffix for resource naming
  env_suffix = substr(var.account_shortname, 8, 3)
  
  # Monitoring namespace for custom metrics
  monitoring_namespace = "FuturesMarketplace/${local.env_suffix}"
  
  # SNS Topic ARNs for alerting
  dev_alerts_sns_arn    = var.monitoring.create && var.monitoring.dev_alerts_topic_name != "" ? "arn:aws:sns:${var.default_region}:${var.account_number}:${var.monitoring.dev_alerts_topic_name}" : ""
  devops_alerts_sns_arn = var.monitoring.create && var.monitoring.devops_alerts_topic_name != "" ? "arn:aws:sns:${var.default_region}:${var.account_number}:${var.monitoring.devops_alerts_topic_name}" : ""
  
  # Use devops alerts for critical (production) or dev alerts for non-prod
  critical_sns_arn = var.account_lifecycle == "prd" ? local.devops_alerts_sns_arn : local.dev_alerts_sns_arn
  
  # Alarm action strategy:
  # - Component alarms: NO notifications (just state tracking for composites)
  # - Composite alarms: YES notifications when notifications_enabled = true
  # This prevents double-alerting when a component triggers its parent composite
  
  # Component alarms - never send notifications (empty actions)
  component_alarm_actions = []
  
  # Composite alarms - send notifications only when enabled
  composite_alarm_actions = var.monitoring.notifications_enabled ? [local.critical_sns_arn] : []
  
  # Alarm evaluation periods - calculated from unhealthy_alarm_period_minutes
  # Different metric sources have different native periods:
  #   - Standard CloudWatch ECS/Lambda/ALB metrics: 300 sec (5 min) periods
  #   - Route53 health checks: 60 sec (1 min) periods
  #   - Canary: runs at configurable rate
  standard_alarm_evaluation_periods = ceil(var.monitoring_schedule.unhealthy_alarm_period_minutes / 5)
  route53_alarm_evaluation_periods  = var.monitoring_schedule.unhealthy_alarm_period_minutes  # period = 60 sec = 1 min
  canary_alarm_evaluation_periods   = max(1, ceil(var.monitoring_schedule.unhealthy_alarm_period_minutes / var.monitoring_schedule.synthetics_canary_rate_minutes))
  
  # Resource references (conditional on service creation)
  ecs_cluster_name = var.ecs_cluster.create ? aws_ecs_cluster.futures_marketplace[0].name : ""
  
  # CloudFront distribution ID (for metrics)
  cloudfront_distribution_id = var.create_core ? aws_cloudfront_distribution.marketplace[0].id : ""
  
  # Service names for metric dimensions
  market_maker_service_name    = var.market_maker.create ? "svc-${var.market_maker["svc_name"]}-${local.env_suffix}" : ""
  notifications_service_name   = var.notifications_service.create ? "svc-${var.notifications_service["svc_name"]}-${local.env_suffix}" : ""
  margin_call_function_name    = var.margin_call_lambda.create ? "margin-call-v2-${local.env_suffix}" : ""
  
  # Log group names for metric filters
  market_maker_log_group    = var.market_maker.create ? "/ecs/${var.market_maker["svc_name"]}-${local.env_suffix}" : ""
  notifications_log_group   = var.notifications_service.create ? "/ecs/${var.notifications_service["svc_name"]}-${local.env_suffix}" : ""
  margin_call_log_group     = var.margin_call_lambda.create ? "/aws/lambda/margin-call-v2-${local.env_suffix}" : ""
  
  # RDS instance identifier
  notifications_rds_identifier = var.notifications_service.create ? "notifications-v2-${local.env_suffix}" : ""
  
  # ALB ARN suffix for metrics (extract from full ARN)
  notifications_alb_arn_suffix = var.notifications_service.create ? replace(aws_alb.notifications_int_use1[0].arn, "arn:aws:elasticloadbalancing:${var.default_region}:${var.account_number}:loadbalancer/", "") : ""
  notifications_tg_arn_suffix  = var.notifications_service.create ? replace(aws_alb_target_group.notifications_int_use1[0].arn, "arn:aws:elasticloadbalancing:${var.default_region}:${var.account_number}:", "") : ""
  
  # Futures UI URL for Synthetics Canary and Route53 Health Check
  futures_ui_url = var.account_lifecycle == "prd" ? "https://futures.lumerin.io" : "https://futures.${var.account_lifecycle}.lumerin.io"
  
  # Extract domain for Route53 health check (remove https://)
  futures_ui_domain = var.account_lifecycle == "prd" ? "futures.lumerin.io" : "futures.${var.account_lifecycle}.lumerin.io"
}

################################################################################
# ROUTE53 HEALTH CHECK - Baseline reachability for all environments
################################################################################

resource "aws_route53_health_check" "futures_ui" {
  count             = var.monitoring.create && var.monitoring.create_alarms && var.create_core ? 1 : 0
  fqdn              = local.futures_ui_domain
  port              = 443
  type              = "HTTPS"
  resource_path     = "/"
  failure_threshold = 3
  request_interval  = 30

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures UI Health Check - ${local.env_suffix}",
      Capability = "Monitoring",
    },
  )
}

################################################################################
# IAM ROLE FOR SYNTHETICS CANARY
################################################################################

resource "aws_iam_role" "synthetics_canary" {
  count = var.monitoring.create && var.monitoring.create_synthetics_canary ? 1 : 0
  name  = "futures-synthetics-canary-role-${local.env_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures Synthetics Canary Role",
      Capability = "Monitoring",
    },
  )
}

resource "aws_iam_role_policy" "synthetics_canary" {
  count = var.monitoring.create && var.monitoring.create_synthetics_canary ? 1 : 0
  name  = "synthetics-canary-policy"
  role  = aws_iam_role.synthetics_canary[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = [
          "${aws_s3_bucket.synthetics_artifacts[0].arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetBucketLocation"
        ]
        Resource = [
          aws_s3_bucket.synthetics_artifacts[0].arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogGroup"
        ]
        Resource = [
          "arn:aws:logs:${var.default_region}:${var.account_number}:log-group:/aws/lambda/cwsyn-*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "CloudWatchSynthetics"
          }
        }
      }
    ]
  })
}

################################################################################
# S3 BUCKET FOR SYNTHETICS ARTIFACTS
################################################################################

resource "aws_s3_bucket" "synthetics_artifacts" {
  count         = var.monitoring.create && var.monitoring.create_synthetics_canary ? 1 : 0
  bucket        = "futures-synthetics-${var.account_number}-${local.env_suffix}"
  force_destroy = true  # Allow deletion even with artifacts present

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures Synthetics Artifacts",
      Capability = "Monitoring",
    },
  )
}

resource "aws_s3_bucket_lifecycle_configuration" "synthetics_artifacts" {
  count  = var.monitoring.create && var.monitoring.create_synthetics_canary ? 1 : 0
  bucket = aws_s3_bucket.synthetics_artifacts[0].id

  rule {
    id     = "expire-old-artifacts"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = 30
    }
  }
}
