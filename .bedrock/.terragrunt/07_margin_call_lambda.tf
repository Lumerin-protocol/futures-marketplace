# Margin Call Lambda - Checks positions and triggers notifications
# Note: URLs are auto-constructed in 00_variables_local.tf from alb_name + domain_zone_name

################################
# IAM ROLE FOR LAMBDA
################################

resource "aws_iam_role" "margin_call_lambda_exec" {
  count = var.margin_call_lambda.create ? 1 : 0
  name  = "margin-call-lambda-role-v2-${substr(var.account_shortname, 8, 3)}"

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
      Name       = "Margin Call Lambda Role v2",
      Capability = null,
    },
  )
}

resource "aws_iam_role_policy_attachment" "margin_call_lambda_basic" {
  count      = var.margin_call_lambda.create ? 1 : 0
  role       = aws_iam_role.margin_call_lambda_exec[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Policy for Lambda to access Secrets Manager
resource "aws_iam_role_policy" "margin_call_secrets_policy" {
  count = var.margin_call_lambda.create ? 1 : 0
  name  = "margin-call-secrets-access"
  role  = aws_iam_role.margin_call_lambda_exec[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          var.create_core ? aws_secretsmanager_secret.futures.arn : null
        ]
      }
    ]
  })
}

# Policy for Lambda VPC access (if needed to call internal ALB)
resource "aws_iam_role_policy_attachment" "margin_call_vpc_execution" {
  count      = var.margin_call_lambda.create ? 1 : 0
  role       = aws_iam_role.margin_call_lambda_exec[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

################################
# SECURITY GROUP FOR LAMBDA
################################

resource "aws_security_group" "margin_call_lambda_use1" {
  count       = var.margin_call_lambda.create ? 1 : 0
  provider    = aws.use1
  name        = "margin-call-lambda-v2-${substr(var.account_shortname, 8, 3)}"
  description = "Security group for Margin Call Lambda"
  vpc_id      = data.aws_vpc.use1_1.id

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Lambda Security Group",
      Capability = null,
    },
  )
}

################################
# CLOUDWATCH LOGS
################################

resource "aws_cloudwatch_log_group" "margin_call_lambda" {
  count             = var.margin_call_lambda.create ? 1 : 0
  provider          = aws.use1
  name              = "/aws/lambda/margin-call-v2-${substr(var.account_shortname, 8, 3)}"
  retention_in_days = 7

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Lambda Log Group",
      Capability = null,
    },
  )
}

################################
# LAMBDA FUNCTION
################################

# Placeholder Lambda function - code will be updated separately
resource "aws_lambda_function" "margin_call" {
  count         = var.margin_call_lambda.create ? 1 : 0
  function_name = "margin-call-v2-${substr(var.account_shortname, 8, 3)}"
  description   = "Checks margin positions and triggers notifications"
  role          = aws_iam_role.margin_call_lambda_exec[0].arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = var.margin_call_lambda["timeout"]
  memory_size   = var.margin_call_lambda["memory_size"]

  # Placeholder code - will be updated with actual deployment
  filename         = "${path.module}/placeholder-lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/placeholder-lambda.zip")

  # Lifecycle: Terraform manages infrastructure, GitHub Actions manages code
  # This ensures Terraform changes (env vars, triggers, IAM) don't overwrite deployed code
  lifecycle {
    ignore_changes = [
      filename,         # GitHub Actions updates the deployment package
      source_code_hash, # Hash changes when code is deployed
    ]
  }

  vpc_config {
    subnet_ids         = [for m in data.aws_subnet.middle_use1_1 : m.id]
    security_group_ids = [aws_security_group.margin_call_lambda_use1[count.index].id]
  }

  environment {
    variables = {
      ETH_NODE_URL                       = var.ethereum_rpc_url # Shev's code expects ETH_NODE_URL
      FUTURES_SUBGRAPH_URL               = var.margin_call_lambda.futures_subgraph_url  # Auto-constructed from alb_name + domain
      SUBGRAPH_API_KEY                   = var.margin_call_lambda.subgraph_api_key
      FUTURES_ADDRESS                    = var.futures_address         # Shared variable
      HASHRATE_ORACLE_ADDRESS            = var.hashrate_oracle_address # Shared variable
      MULTICALL_ADDRESS                  = var.multicall_address       # Shared variable (Multicall3)
      NOTIFICATIONS_SERVICE_URL          = local.notifications_url     # Auto-constructed from alb_name + domain
      LOG_LEVEL                          = var.margin_call_lambda.log_level
      MARGIN_UTILIZATION_WARNING_PERCENT = var.margin_call_lambda.margin_utilization_warning_percent # Shev's code expects MARGIN_ALERT_THRESHOLD
    }
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Lambda Function v2",
      Capability = null,
    },
  )
}

################################
# EVENTBRIDGE SCHEDULE
################################

resource "aws_cloudwatch_event_rule" "margin_call_schedule" {
  count               = var.margin_call_lambda.create ? 1 : 0
  name                = "margin-call-schedule-v2-${substr(var.account_shortname, 8, 3)}"
  description         = "Trigger margin call check every ${var.margin_call_lambda["job_interval"]} minutes"
  schedule_expression = "rate(${var.margin_call_lambda["job_interval"]} minutes)"

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Schedule",
      Capability = null,
    },
  )
}

resource "aws_cloudwatch_event_target" "margin_call_lambda_target" {
  count     = var.margin_call_lambda.create ? 1 : 0
  rule      = aws_cloudwatch_event_rule.margin_call_schedule[0].name
  target_id = "margin-call-lambda-v2"
  arn       = aws_lambda_function.margin_call[0].arn
}

resource "aws_lambda_permission" "allow_cloudwatch_margin_call" {
  count         = var.margin_call_lambda.create ? 1 : 0
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.margin_call[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.margin_call_schedule[0].arn
}

################################
# DAILY SCHEDULE (with daily_flag)
################################

resource "aws_cloudwatch_event_rule" "margin_call_daily_schedule" {
  count               = var.margin_call_lambda.create ? 1 : 0
  name                = "margin-call-daily-schedule-v2-${substr(var.account_shortname, 8, 3)}"
  description         = "Trigger margin call daily check (runs once per day with executeMarginCall flag)"
  schedule_expression = "cron(${var.margin_call_lambda["daily_schedule_minute"]} ${var.margin_call_lambda["daily_schedule_hour"]} * * ? *)"

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Daily Schedule",
      Capability = null,
    },
  )
}

resource "aws_cloudwatch_event_target" "margin_call_daily_lambda_target" {
  count     = var.margin_call_lambda.create ? 1 : 0
  rule      = aws_cloudwatch_event_rule.margin_call_daily_schedule[0].name
  target_id = "margin-call-lambda-daily-v2"
  arn       = aws_lambda_function.margin_call[0].arn

  # Pass daily_flag as input to Lambda
  input = jsonencode({
    executeMarginCall = true
  })
}

resource "aws_lambda_permission" "allow_cloudwatch_margin_call_daily" {
  count         = var.margin_call_lambda.create ? 1 : 0
  statement_id  = "AllowExecutionFromCloudWatchDaily"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.margin_call[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.margin_call_daily_schedule[0].arn
}

################################
# CLOUDWATCH ALARMS
################################

resource "aws_cloudwatch_metric_alarm" "margin_call_errors" {
  count               = var.margin_call_lambda.create ? 1 : 0
  alarm_name          = "margin-call-lambda-errors-v2-${substr(var.account_shortname, 8, 3)}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "300"
  statistic           = "Sum"
  threshold           = "0"
  alarm_description   = "This metric monitors margin call lambda errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.margin_call[0].function_name
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Lambda Errors Alarm",
      Capability = null,
    },
  )
}

resource "aws_cloudwatch_metric_alarm" "margin_call_duration" {
  count               = var.margin_call_lambda.create ? 1 : 0
  alarm_name          = "margin-call-lambda-duration-v2-${substr(var.account_shortname, 8, 3)}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = "300"
  statistic           = "Average"
  threshold           = tostring(var.margin_call_lambda["timeout"] * 1000 * 0.8) # 80% of timeout in ms
  alarm_description   = "This metric monitors margin call lambda duration approaching timeout"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.margin_call[0].function_name
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Margin Call Lambda Duration Alarm",
      Capability = null,
    },
  )
}

################################
# PLACEHOLDER LAMBDA ZIP
################################

# Create a minimal placeholder Lambda zip file (only runs once at initial creation)
# After initial creation, GitHub Actions deploys the real code
resource "null_resource" "create_placeholder_lambda" {
  count = var.margin_call_lambda.create ? 1 : 0

  provisioner "local-exec" {
    command = <<-EOT
      echo 'exports.handler = async (event) => { return { statusCode: 200, body: "Placeholder" }; };' > /tmp/main.js
      cd /tmp && zip -q ${path.module}/placeholder-lambda.zip main.js
      rm /tmp/main.js
    EOT
  }

  # No triggers - only runs once during initial creation
  # The lifecycle rules on aws_lambda_function prevent Terraform from overwriting GitHub Actions deployments
}

# Test the Lambda function using the AWS Console Test UI or AWS CLI:
# aws lambda invoke --function-name margin-call-dev \
#   --payload '{"test":true}' \
#   --cli-binary-format raw-in-base64-out \
#   --profile titanio-dev \
#   --region us-east-1 \
#   response.json && cat response.json


