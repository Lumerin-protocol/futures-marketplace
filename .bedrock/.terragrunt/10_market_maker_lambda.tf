# Market Maker Lambda - Automated Trading Bot
# Runs as a scheduled Lambda function (replaces ECS service for better resilience)

################################
# IAM ROLE FOR LAMBDA
################################

resource "aws_iam_role" "market_maker_lambda_exec" {
  count = var.market_maker.create ? 1 : 0
  name  = "market-maker-lambda-role-${substr(var.account_shortname, 8, 3)}"

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
      Name       = "Market Maker Lambda Role",
      Capability = null,
    },
  )
}

resource "aws_iam_role_policy_attachment" "market_maker_lambda_basic" {
  count      = var.market_maker.create ? 1 : 0
  role       = aws_iam_role.market_maker_lambda_exec[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Policy for Lambda to access Secrets Manager
resource "aws_iam_role_policy" "market_maker_secrets_policy" {
  count = var.market_maker.create ? 1 : 0
  name  = "market-maker-secrets-access"
  role  = aws_iam_role.market_maker_lambda_exec[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.market_maker.arn
        ]
      }
    ]
  })
}

# Policy for Lambda VPC access
resource "aws_iam_role_policy_attachment" "market_maker_vpc_execution" {
  count      = var.market_maker.create ? 1 : 0
  role       = aws_iam_role.market_maker_lambda_exec[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

################################
# SECURITY GROUP FOR LAMBDA
################################

resource "aws_security_group" "market_maker_lambda_use1" {
  count       = var.market_maker.create ? 1 : 0
  provider    = aws.use1
  name        = "market-maker-lambda-${substr(var.account_shortname, 8, 3)}"
  description = "Security group for Market Maker Lambda"
  vpc_id      = data.aws_vpc.use1_1.id

  egress {
    description = "Allow all outbound (ETH Node, Subgraph APIs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Lambda Security Group",
      Capability = null,
    },
  )
}

################################
# CLOUDWATCH LOGS
################################

resource "aws_cloudwatch_log_group" "market_maker_lambda" {
  count             = var.market_maker.create ? 1 : 0
  provider          = aws.use1
  name              = "/aws/lambda/market-maker-${substr(var.account_shortname, 8, 3)}"
  retention_in_days = 7

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Lambda Log Group",
      Capability = null,
    },
  )
}

################################
# LAMBDA FUNCTION
################################

resource "aws_lambda_function" "market_maker" {
  count         = var.market_maker.create ? 1 : 0
  function_name = "market-maker-${substr(var.account_shortname, 8, 3)}"
  description   = "Automated market maker for futures trading"
  role          = aws_iam_role.market_maker_lambda_exec[0].arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = var.market_maker["timeout"]
  memory_size   = var.market_maker["memory_size"]

  # Placeholder code - will be updated with actual deployment
  filename         = "${path.module}/placeholder-lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/placeholder-lambda.zip")

  # Lifecycle: Terraform manages infrastructure, GitHub Actions manages code
  lifecycle {
    ignore_changes = [
      filename,
      source_code_hash,
    ]
  }

  vpc_config {
    subnet_ids         = [for m in data.aws_subnet.middle_use1_1 : m.id]
    security_group_ids = [aws_security_group.market_maker_lambda_use1[count.index].id]
  }

  environment {
    variables = {
      # Trading Parameters
      FLOAT_AMOUNT                = tostring(var.market_maker.float_amount)
      SPREAD_AMOUNT               = tostring(var.market_maker.spread_amount)
      GRID_LEVELS                 = tostring(var.market_maker.grid_levels)
      ACTIVE_QUOTING_AMOUNT_RATIO = tostring(var.market_maker.active_quoting_amount_ratio)
      RISK_AVERSION               = tostring(var.market_maker.risk_aversion)
      MAX_POSITION                = tostring(var.market_maker.max_position)
      LOG_LEVEL                   = tostring(var.market_maker.log_level)
      
      # Contract Configuration
      FUTURES_ADDRESS = var.futures_address
      CHAIN_ID        = tostring(var.market_maker.chain_id)
      
      # Balance Thresholds (for graceful exit when funds are low)
      MIN_ETH_BALANCE  = tostring(var.market_maker.min_eth_balance)
      MIN_USDC_BALANCE = tostring(var.market_maker.min_usdc_balance)
      
      # Secrets are fetched at runtime via AWS SDK
      SECRETS_ARN = aws_secretsmanager_secret.market_maker.arn
    }
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Lambda Function",
      Capability = null,
    },
  )
}

################################
# EVENTBRIDGE SCHEDULE
################################

resource "aws_cloudwatch_event_rule" "market_maker_schedule" {
  count               = var.market_maker.create ? 1 : 0
  name                = "market-maker-schedule-${substr(var.account_shortname, 8, 3)}"
  description         = "Trigger market maker every ${var.market_maker["schedule_rate"]} minute(s)"
  schedule_expression = "rate(${var.market_maker["schedule_rate"]} ${tonumber(var.market_maker["schedule_rate"]) == 1 ? "minute" : "minutes"})"

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Schedule",
      Capability = null,
    },
  )
}

resource "aws_cloudwatch_event_target" "market_maker_lambda_target" {
  count     = var.market_maker.create ? 1 : 0
  rule      = aws_cloudwatch_event_rule.market_maker_schedule[0].name
  target_id = "market-maker-lambda"
  arn       = aws_lambda_function.market_maker[0].arn
}

resource "aws_lambda_permission" "allow_cloudwatch_market_maker" {
  count         = var.market_maker.create ? 1 : 0
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.market_maker[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.market_maker_schedule[0].arn
}
