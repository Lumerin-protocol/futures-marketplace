# Market Maker Service - Automated Trading Bot
# Runs as an ECS Fargate service without external ALB (internal service only)

################################
# SECURITY GROUPS
################################

# Dedicated security group for Market Maker ECS tasks
resource "aws_security_group" "market_maker_ecs_use1" {
  count       = var.market_maker.create ? 1 : 0
  provider    = aws.use1
  name        = "${var.market_maker.svc_name}-ecs-svc-${substr(var.account_shortname, 8, 3)}"
  description = "Security group for Market Maker ECS tasks"
  vpc_id      = data.aws_vpc.use1_1.id
  # All rules managed via separate aws_security_group_rule resources below
  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker ECS Security Group",
      Capability = null,
    },
  )
}

################################
# SECURITY GROUP RULES - ECS
################################

# ECS egress HTTPS (for Subgraph API, ETH Node, etc.)
resource "aws_security_group_rule" "market_maker_ecs_egress_https" {
  count             = var.market_maker.create ? 1 : 0
  provider          = aws.use1
  type              = "egress"
  description       = "HTTPS outbound"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.market_maker_ecs_use1[count.index].id
  cidr_blocks       = ["0.0.0.0/0"]
}

# ECS egress HTTP (if needed for some endpoints)
resource "aws_security_group_rule" "market_maker_ecs_egress_http" {
  count             = var.market_maker.create ? 1 : 0
  provider          = aws.use1
  type              = "egress"
  description       = "HTTP outbound"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  security_group_id = aws_security_group.market_maker_ecs_use1[count.index].id
  cidr_blocks       = ["0.0.0.0/0"]
}

################################
# CLOUDWATCH LOGS
################################

resource "aws_cloudwatch_log_group" "market_maker_use1" {
  count             = var.market_maker.create ? 1 : 0
  provider          = aws.use1
  name              = "/ecs/${var.market_maker["svc_name"]}-${substr(var.account_shortname, 8, 3)}"
  retention_in_days = 7

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker ECS Log Group",
      Capability = null,
    },
  )
}

################################
# ECS SERVICE & TASK 
################################

# Define Service
resource "aws_ecs_service" "market_maker_use1" {
  # lifecycle {ignore_changes = [task_definition] }
  count                  = var.market_maker.create ? 1 : 0
  provider               = aws.use1
  name                   = "svc-${var.market_maker["svc_name"]}-${substr(var.account_shortname, 8, 3)}"
  cluster                = aws_ecs_cluster.futures_marketplace[0].id
  task_definition        = aws_ecs_task_definition.market_maker_use1[count.index].arn
  desired_count          = var.market_maker["task_worker_qty"]
  launch_type            = "FARGATE"
  propagate_tags         = "SERVICE"
  enable_execute_command = true

  # Market maker requirement: Only one instance should be active to avoid conflicting trades
  # Kill old task before starting new one (recreate deployment strategy)
  deployment_minimum_healthy_percent = 0   # Allow stopping all old tasks
  deployment_maximum_percent         = 100 # Only run desired_count (1 task max)

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [for m in data.aws_subnet.middle_use1_1 : m.id]
    assign_public_ip = false
    security_groups  = [aws_security_group.market_maker_ecs_use1[count.index].id]
  }

  # No load balancer - this is an internal trading service with no HTTP endpoints

  depends_on = [
    aws_ecs_task_definition.market_maker_use1
  ]

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker Service",
      Capability = null,
    },
  )
}

# Define Task  
resource "aws_ecs_task_definition" "market_maker_use1" {
  # lifecycle { ignore_changes = [container_definitions] }
  count                    = var.market_maker.create ? 1 : 0
  provider                 = aws.use1
  family                   = "tsk-${var.market_maker["svc_name"]}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.market_maker["task_cpu"]
  memory                   = var.market_maker["task_ram"]
  task_role_arn            = local.titanio_role_arn
  execution_role_arn       = local.titanio_role_arn

  container_definitions = jsonencode([
    {
      name        = "${var.market_maker["cnt_name"]}-container"
      image       = "${var.market_maker["mm_ghcr_repo"]}:${local.market_maker_image_tag}"
      cpu         = 0
      launch_type = "FARGATE"
      essential   = true

      # No port mappings - this is a background worker with no HTTP endpoints
      environment = [
        # Subgraph Configuration
        {
          name  = "FUTURES_SUBGRAPH_URL"
          value = tostring(var.market_maker.subgraph_url_futures)
        },
        {
          name  = "ORACLES_SUBGRAPH_URL"
          value = tostring(var.market_maker.subgraph_url_oracles)
        },
        {
          name  = "SUBGRAPH_API_KEY"
          value = tostring(var.market_maker.subgraph_api_key)
        },
        # Trading Parameters
        {
          name  = "FLOAT_AMOUNT"
          value = tostring(var.market_maker.float_amount)
        },
        {
          name  = "SPREAD_AMOUNT"
          value = tostring(var.market_maker.spread_amount)
        },
        {
          name  = "GRID_LEVELS"
          value = tostring(var.market_maker.grid_levels)
        },
        {
          name  = "ACTIVE_QUOTING_AMOUNT_RATIO"
          value = tostring(var.market_maker.active_quoting_amount_ratio)
        },
        {
          name  = "RISK_AVERSION"
          value = tostring(var.market_maker.risk_aversion)
        },
        # Contract Configuration
        {
          name  = "FUTURES_ADDRESS"
          value = var.futures_address
        },
        {
          name  = "CHAIN_ID"
          value = tostring(var.market_maker.chain_id)
        },
        # Operational Parameters
        {
          name  = "LOOP_INTERVAL_MS"
          value = tostring(var.market_maker.loop_interval_ms)
        },
        {
          name  = "MAX_POSITION"
          value = tostring(var.market_maker.max_position)
        },
        {
          name  = "LOG_LEVEL"
          value = tostring(var.market_maker.log_level)
        }
      ]
      secrets = [
        # Secrets (from Secrets Manager)
        {
          name  = "ETH_NODE_URL"
          valueFrom = "${aws_secretsmanager_secret.market_maker.arn}:eth_node_url::"
        },
        {
          name  = "PRIVATE_KEY"
          valueFrom = "${aws_secretsmanager_secret.market_maker.arn}:private_key::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-create-group"  = "true"
          "awslogs-group"         = aws_cloudwatch_log_group.market_maker_use1[0].name
          "awslogs-region"        = var.default_region
          "awslogs-stream-prefix" = "${var.market_maker.svc_name}-tsk"
        }
      }
    }
  ])

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Market Maker ECS Task Definition",
      Capability = null,
    },
  )
}

