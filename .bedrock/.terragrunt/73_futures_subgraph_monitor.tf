################################################################################
# FUTURES SUBGRAPH INDEX
# The endpoint, the indexed head, indexing errors, and a live order entity.
# Newest trade age is a metric only. Component alarms do not notify.
################################################################################

locals {
  futures_subgraph_monitor_name = "futures-subgraph-health-${local.env_suffix}"
  futures_subgraph_check_seconds = 300
  futures_subgraph_stale_seconds = 900
  futures_subgraph_eval_periods  = ceil(var.monitoring_schedule.unhealthy_alarm_period_minutes / 5)
}

data "archive_file" "futures_subgraph_monitor" {
  count       = var.monitoring.create ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/73_subgraph_index_monitor.py"
  output_path = "${path.module}/futures_subgraph_monitor_${filemd5("${path.module}/73_subgraph_index_monitor.py")}.zip"
}

resource "aws_iam_role" "futures_subgraph_monitor" {
  count    = var.monitoring.create ? 1 : 0
  provider = aws.use1
  name     = local.futures_subgraph_monitor_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = merge(var.default_tags, var.foundation_tags, {
    Name       = "Futures Subgraph Monitor"
    Capability = "Monitoring"
  })
}

resource "aws_iam_role_policy" "futures_subgraph_monitor" {
  count    = var.monitoring.create ? 1 : 0
  provider = aws.use1
  name     = "futures-subgraph-monitor"
  role     = aws_iam_role.futures_subgraph_monitor[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.default_region}:${var.account_number}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "futures_subgraph_monitor" {
  count         = var.monitoring.create ? 1 : 0
  provider      = aws.use1
  function_name = local.futures_subgraph_monitor_name
  description   = "Checks the hpow-futures index is answering, fresh, and has orders"
  role          = aws_iam_role.futures_subgraph_monitor[0].arn
  handler       = "73_subgraph_index_monitor.lambda_handler"
  runtime       = "python3.12"
  timeout       = 60
  memory_size   = 256

  filename         = data.archive_file.futures_subgraph_monitor[0].output_path
  source_code_hash = data.archive_file.futures_subgraph_monitor[0].output_base64sha256

  environment {
    variables = {
      GS_URL        = var.gs_subgraphs["futures"]
      CW_NAMESPACE  = local.monitoring_namespace
      ENVIRONMENT   = local.env_suffix
      SUBGRAPH_NAME = "futures"
      ENTITY_KIND   = "orders"
    }
  }

  tags = merge(var.default_tags, var.foundation_tags, {
    Name       = "Futures Subgraph Monitor"
    Capability = "Monitoring"
  })
}

resource "aws_cloudwatch_event_rule" "futures_subgraph_monitor" {
  count               = var.monitoring.create ? 1 : 0
  provider            = aws.use1
  name                = "${local.futures_subgraph_monitor_name}-schedule"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "futures_subgraph_monitor" {
  count     = var.monitoring.create ? 1 : 0
  provider  = aws.use1
  rule      = aws_cloudwatch_event_rule.futures_subgraph_monitor[0].name
  target_id = "futures-subgraph-monitor"
  arn       = aws_lambda_function.futures_subgraph_monitor[0].arn
}

resource "aws_lambda_permission" "futures_subgraph_monitor" {
  count         = var.monitoring.create ? 1 : 0
  provider      = aws.use1
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.futures_subgraph_monitor[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.futures_subgraph_monitor[0].arn
}

resource "aws_cloudwatch_metric_alarm" "futures_subgraph_unavailable" {
  count               = var.monitoring.create && var.monitoring.create_alarms ? 1 : 0
  provider            = aws.use1
  alarm_name          = "futures-subgraph-unavailable-${local.env_suffix}"
  alarm_description   = "Futures subgraph did not answer"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = local.futures_subgraph_eval_periods
  metric_name         = "subgraphs_available"
  namespace           = local.monitoring_namespace
  period              = local.futures_subgraph_check_seconds
  statistic           = "Minimum"
  threshold           = 1
  treat_missing_data  = "breaching"
  dimensions          = { Environment = local.env_suffix }
  alarm_actions       = []
  ok_actions          = []
}

resource "aws_cloudwatch_metric_alarm" "futures_subgraph_errors" {
  count               = var.monitoring.create && var.monitoring.create_alarms ? 1 : 0
  provider            = aws.use1
  alarm_name          = "futures-subgraph-indexing-errors-${local.env_suffix}"
  alarm_description   = "Futures subgraph reports indexing errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.futures_subgraph_eval_periods
  metric_name         = "subgraph_indexing_errors"
  namespace           = local.monitoring_namespace
  period              = local.futures_subgraph_check_seconds
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions = {
    Environment = local.env_suffix
    Subgraph    = "futures"
  }
  alarm_actions = []
  ok_actions    = []
}

resource "aws_cloudwatch_metric_alarm" "futures_subgraph_stale" {
  count               = var.monitoring.create && var.monitoring.create_alarms ? 1 : 0
  provider            = aws.use1
  alarm_name          = "futures-subgraph-stale-${local.env_suffix}"
  alarm_description   = "Futures subgraph indexed head is older than 15 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = local.futures_subgraph_eval_periods
  metric_name         = "subgraph_data_age_seconds"
  namespace           = local.monitoring_namespace
  period              = local.futures_subgraph_check_seconds
  statistic           = "Maximum"
  threshold           = local.futures_subgraph_stale_seconds
  treat_missing_data  = "breaching"
  dimensions = {
    Environment = local.env_suffix
    Subgraph    = "futures"
  }
  alarm_actions = []
  ok_actions    = []
}

resource "aws_cloudwatch_metric_alarm" "futures_subgraph_empty" {
  count               = var.monitoring.create && var.monitoring.create_alarms ? 1 : 0
  provider            = aws.use1
  alarm_name          = "futures-subgraph-empty-${local.env_suffix}"
  alarm_description   = "Futures subgraph has no order entity"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = local.futures_subgraph_eval_periods
  metric_name         = "subgraph_entity_present"
  namespace           = local.monitoring_namespace
  period              = local.futures_subgraph_check_seconds
  statistic           = "Minimum"
  threshold           = 1
  treat_missing_data  = "breaching"
  dimensions = {
    Environment = local.env_suffix
    Subgraph    = "futures"
  }
  alarm_actions = []
  ok_actions    = []
}

resource "aws_cloudwatch_composite_alarm" "futures_subgraph_unhealthy" {
  count             = var.monitoring.create && var.monitoring.create_alarms ? 1 : 0
  provider          = aws.use1
  alarm_name        = "futures-subgraph-${local.env_suffix}"
  alarm_description = "Futures index is down, erroring, stale, or empty"

  alarm_rule = join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.futures_subgraph_unavailable[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.futures_subgraph_errors[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.futures_subgraph_stale[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.futures_subgraph_empty[0].alarm_name})",
  ])

  alarm_actions = local.composite_alarm_actions
  ok_actions    = local.composite_alarm_actions

  tags = merge(var.default_tags, var.foundation_tags, {
    Name       = "Futures Subgraph Unhealthy"
    Capability = "Monitoring"
  })
}
