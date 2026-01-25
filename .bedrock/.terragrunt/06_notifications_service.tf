# USE1_1 Definition
# Notifications Service - Telegram Bot with RDS PostgreSQL

################################
# SECURITY GROUPS
################################

# Dedicated security group for Notifications ALB (Internal)
resource "aws_security_group" "notifications_alb_use1" {
  count       = var.notifications_service.create ? 1 : 0
  provider    = aws.use1
  name        = "notifications-alb-int-v2-${substr(var.account_shortname, 8, 3)}"
  description = "Security group for Notifications internal ALB"
  vpc_id      = data.aws_vpc.use1_1.id

  # Allow HTTPS from VPC (internal ALB)
  ingress {
    description = "HTTPS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.use1_1.cidr_block, "172.18.0.0/19"] # VPC + VPN
  }

  # Allow all outbound
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
      Name       = "Notifications ALB Security Group",
      Capability = null,
    },
  )
}

# Dedicated security group for Notifications ECS tasks
resource "aws_security_group" "notifications_ecs_use1" {
  count       = var.notifications_service.create ? 1 : 0
  provider    = aws.use1
  name        = "notifications-ecs-v2-${substr(var.account_shortname, 8, 3)}"
  description = "Security group for Notifications ECS tasks"
  vpc_id      = data.aws_vpc.use1_1.id

  # All rules managed via separate aws_security_group_rule resources below

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications ECS Security Group",
      Capability = null,
    },
  )
}

################################
# SECURITY GROUP RULES - ECS
################################

# ECS ingress from ALB
resource "aws_security_group_rule" "notifications_ecs_from_alb" {
  count                    = var.notifications_service.create ? 1 : 0
  provider                 = aws.use1
  type                     = "ingress"
  description              = "HTTP from ALB"
  from_port                = var.notifications_service["cnt_port"]
  to_port                  = var.notifications_service["cnt_port"]
  protocol                 = "tcp"
  security_group_id        = aws_security_group.notifications_ecs_use1[count.index].id
  source_security_group_id = aws_security_group.notifications_alb_use1[count.index].id
}

# ECS egress to RDS (breaks circular dependency)
resource "aws_security_group_rule" "notifications_ecs_to_rds" {
  count                    = var.notifications_service.create ? 1 : 0
  provider                 = aws.use1
  type                     = "egress"
  description              = "PostgreSQL to RDS"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.notifications_ecs_use1[count.index].id
  source_security_group_id = aws_security_group.notifications_rds_use1[count.index].id
}

# ECS egress HTTPS (for Telegram API, etc.)
resource "aws_security_group_rule" "notifications_ecs_egress_https" {
  count             = var.notifications_service.create ? 1 : 0
  provider          = aws.use1
  type              = "egress"
  description       = "HTTPS outbound"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.notifications_ecs_use1[count.index].id
  cidr_blocks       = ["0.0.0.0/0"]
}

# ECS egress HTTP (if needed)
resource "aws_security_group_rule" "notifications_ecs_egress_http" {
  count             = var.notifications_service.create ? 1 : 0
  provider          = aws.use1
  type              = "egress"
  description       = "HTTP outbound"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  security_group_id = aws_security_group.notifications_ecs_use1[count.index].id
  cidr_blocks       = ["0.0.0.0/0"]
}

################################
# SECURITY GROUP RULES - RDS
################################

# RDS ingress from ECS (breaks circular dependency)
resource "aws_security_group_rule" "notifications_rds_from_ecs" {
  count                    = var.notifications_service.create ? 1 : 0
  provider                 = aws.use1
  type                     = "ingress"
  description              = "PostgreSQL from ECS tasks"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.notifications_rds_use1[count.index].id
  source_security_group_id = aws_security_group.notifications_ecs_use1[count.index].id
}

# RDS ingress from VPN (for debugging)
resource "aws_security_group_rule" "notifications_rds_from_vpn" {
  count             = var.notifications_service.create ? 1 : 0
  provider          = aws.use1
  type              = "ingress"
  description       = "PostgreSQL from VPN"
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  security_group_id = aws_security_group.notifications_rds_use1[count.index].id
  cidr_blocks       = ["172.18.0.0/19"]
}

# RDS egress all
resource "aws_security_group_rule" "notifications_rds_egress_all" {
  count             = var.notifications_service.create ? 1 : 0
  provider          = aws.use1
  type              = "egress"
  description       = "Allow all outbound"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.notifications_rds_use1[count.index].id
  cidr_blocks       = ["0.0.0.0/0"]
}

# Security group for RDS
resource "aws_security_group" "notifications_rds_use1" {
  count       = var.notifications_service.create ? 1 : 0
  provider    = aws.use1
  name        = "notifications-rds-v2-${substr(var.account_shortname, 8, 3)}"
  description = "Security group for Notifications RDS PostgreSQL"
  vpc_id      = data.aws_vpc.use1_1.id

  # All rules managed via separate aws_security_group_rule resources above

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications RDS Security Group",
      Capability = null,
    },
  )
}

################################
# RDS POSTGRESQL
################################

# DB Subnet Group
resource "aws_db_subnet_group" "notifications_use1" {
  count      = var.notifications_service.create ? 1 : 0
  provider   = aws.use1
  name       = "notifications-db-subnet-v2-${substr(var.account_shortname, 8, 3)}"
  subnet_ids = [for m in data.aws_subnet.middle_use1_1 : m.id]

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications DB Subnet Group",
      Capability = null,
    },
  )
}

# RDS PostgreSQL Instance
resource "aws_db_instance" "notifications_use1" {
  lifecycle {
    ignore_changes = [engine_version]
  }
  count                         = var.notifications_service.create ? 1 : 0
  provider                      = aws.use1
  identifier                    = "notifications-v2-${substr(var.account_shortname, 8, 3)}"
  engine                        = "postgres"
  engine_version                = "17.4"
  instance_class                = var.notifications_service["db_instance_class"]
  allocated_storage             = var.notifications_service["db_allocated_storage"]
  max_allocated_storage         = var.notifications_service["db_max_allocated_storage"]
  storage_type                  = "gp3"
  storage_encrypted             = true
  db_name                       = "notifications"
  username                      = "notificationsadmin"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = null

  db_subnet_group_name   = aws_db_subnet_group.notifications_use1[count.index].name
  vpc_security_group_ids = [aws_security_group.notifications_rds_use1[count.index].id]

  parameter_group_name = aws_db_parameter_group.notifications_use1[count.index].name

  backup_retention_period = var.notifications_service["db_backup_retention_period"]
  backup_window           = var.notifications_service["db_backup_window"]
  maintenance_window      = var.notifications_service["db_maintenance_window"]

  skip_final_snapshot       = var.notifications_service.protect ? false : true
  final_snapshot_identifier = var.notifications_service.protect ? "notifications-final-${substr(var.account_shortname, 8, 3)}-${formatdate("YYYY-MM-DD-hhmm", timestamp())}" : null

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications RDS PostgreSQL",
      Capability = null,
    },
  )
}

# DB Parameter Group
resource "aws_db_parameter_group" "notifications_use1" {
  count    = var.notifications_service.create ? 1 : 0
  provider = aws.use1
  name     = "notifications-pg17-v2-${substr(var.account_shortname, 8, 3)}"
  family   = "postgres17"

  parameter {
    name         = "max_connections"
    value        = var.notifications_service["db_max_connections"]
    apply_method = "pending-reboot"
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications DB Parameter Group",
      Capability = null,
    },
  )
}

################################
# CLOUDWATCH LOGS
################################

resource "aws_cloudwatch_log_group" "notifications_use1" {
  count             = var.notifications_service.create ? 1 : 0
  provider          = aws.use1
  name              = "/ecs/${var.notifications_service["svc_name"]}-${substr(var.account_shortname, 8, 3)}"
  retention_in_days = 7

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications ECS Log Group",
      Capability = null,
    },
  )
}

################################
# ECS SERVICE & TASK 
################################

# Define Service
resource "aws_ecs_service" "notifications_use1" {
  lifecycle {ignore_changes = [task_definition] }
  count                  = var.notifications_service.create ? 1 : 0
  provider               = aws.use1
  name                   = "svc-${var.notifications_service["svc_name"]}-${substr(var.account_shortname, 8, 3)}"
  cluster                = aws_ecs_cluster.futures_marketplace[0].id
  task_definition        = aws_ecs_task_definition.notifications_use1[count.index].arn
  desired_count          = var.notifications_service["task_worker_qty"]
  launch_type            = "FARGATE"
  propagate_tags         = "SERVICE"
  enable_execute_command = true

  # Telegram bot requirement: Only one instance can be active at a time
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
    security_groups  = [aws_security_group.notifications_ecs_use1[count.index].id]
  }

  load_balancer {
    target_group_arn = aws_alb_target_group.notifications_int_use1[count.index].arn
    container_name   = "${var.notifications_service["cnt_name"]}-container"
    container_port   = var.notifications_service["cnt_port"]
  }

  depends_on = [
    aws_ecs_task_definition.notifications_use1,
    aws_db_instance.notifications_use1
  ]

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications Service",
      Capability = null,
    },
  )
}

# Define Task  
resource "aws_ecs_task_definition" "notifications_use1" {
  lifecycle { ignore_changes = [container_definitions] }
  count                    = var.notifications_service.create ? 1 : 0
  provider                 = aws.use1
  family                   = "tsk-${var.notifications_service["svc_name"]}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.notifications_service["task_cpu"]
  memory                   = var.notifications_service["task_ram"]
  task_role_arn            = local.titanio_role_arn
  execution_role_arn       = local.titanio_role_arn

  container_definitions = jsonencode([
    {
      name        = "${var.notifications_service["cnt_name"]}-container"
      image       = "${var.notifications_service["ntf_ghcr_repo"]}:${var.notifications_service["ntf_imagetag"]}"
      cpu         = 0
      launch_type = "FARGATE"
      essential   = true

      portMappings = [
        {
          containerPort = tonumber(var.notifications_service["cnt_port"])
          hostPort      = tonumber(var.notifications_service["cnt_port"])
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "PORT"
          value = tostring(var.notifications_service["cnt_port"])
        },
        {
          name  = "LOG_LEVEL"
          value = "info"
        },
        {
          name  = "DATABASE_URL"
          value = "postgresql://${aws_db_instance.notifications_use1[count.index].username}:${aws_db_instance.notifications_use1[count.index].master_user_secret[0].secret_arn}@${aws_db_instance.notifications_use1[count.index].endpoint}/${aws_db_instance.notifications_use1[count.index].db_name}"
        }
      ]
      secrets = [
        {
          name  = "TELEGRAM_BOT_TOKEN"
          valueFrom = "${aws_secretsmanager_secret.notifications.arn}:telegram_bot_token::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-create-group"  = "true"
          "awslogs-group"         = aws_cloudwatch_log_group.notifications_use1[0].name
          "awslogs-region"        = var.default_region
          "awslogs-stream-prefix" = "${var.notifications_service["svc_name"]}-tsk"
        }
      }
    }
  ])

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications ECS Task Definition",
      Capability = null,
    },
  )
}

################################
# APPLICATION LOAD BALANCER (INTERNAL)
################################

# INTERNAL ALB
resource "aws_alb" "notifications_int_use1" {
  count                      = var.notifications_service.create ? 1 : 0
  provider                   = aws.use1
  name                       = "alb-${var.notifications_service["svc_name"]}-${substr(var.account_shortname, 8, 3)}"
  internal                   = true
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.notifications_alb_use1[count.index].id]
  subnets                    = [for m in data.aws_subnet.middle_use1_1 : m.id]
  enable_deletion_protection = false

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications Internal ALB",
      Capability = null,
    },
  )
}

# ALB Internal Target group
resource "aws_alb_target_group" "notifications_int_use1" {
  count                         = var.notifications_service.create ? 1 : 0
  provider                      = aws.use1
  name                          = "tg-notification-v2-${var.notifications_service["cnt_port"]}"
  port                          = tonumber(var.notifications_service["cnt_port"])
  protocol                      = "HTTP"
  vpc_id                        = data.aws_vpc.use1_1.id
  target_type                   = "ip"
  load_balancing_algorithm_type = "round_robin"
  deregistration_delay          = "10"

  health_check {
    enabled             = true
    interval            = 30
    path                = "/healthcheck"
    port                = var.notifications_service["cnt_port"]
    protocol            = "HTTP"
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications Internal ALB Target Group",
      Capability = null,
    },
  )
}

# Create listeners on the ALB 
resource "aws_alb_listener" "notifications_int_443_use1" {
  count             = var.notifications_service.create ? 1 : 0
  provider          = aws.use1
  load_balancer_arn = aws_alb.notifications_int_use1[count.index].arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-FS-1-2-Res-2020-10"
  certificate_arn   = data.aws_acm_certificate.lumerin_marketplace_ext.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.notifications_int_use1[count.index].arn
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Notifications Internal ALB Listener",
      Capability = null,
    },
  )
}

# Define Route53 Alias to load balancer (internal zone)
resource "aws_route53_record" "notifications_int_use1" {
  count    = var.notifications_service.create ? 1 : 0
  provider = aws.use1
  zone_id  = data.aws_route53_zone.public_lumerin.zone_id
  name     = "${var.notifications_service["alb_name"]}${data.aws_route53_zone.public_lumerin.name}"
  type     = "A"

  alias {
    name                   = aws_alb.notifications_int_use1[count.index].dns_name
    zone_id                = aws_alb.notifications_int_use1[count.index].zone_id
    evaluate_target_health = true
  }
}


