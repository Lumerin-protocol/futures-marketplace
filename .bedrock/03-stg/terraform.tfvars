create_core = true

ecs_cluster = {
  create  = true
  protect = false
}

# Configure Market Maker
market_maker = {
  create                      = true
  mm_imagetag                 = "auto" #"v0.1.0-dev"
  mm_ghcr_repo                = "ghcr.io/lumerin-protocol/market-maker"
  svc_name                    = "market-maker"
  cnt_name                    = "market-maker"
  cnt_port                    = 3000
  task_cpu                    = 256
  task_ram                    = 512
  task_worker_qty             = 1
  friendly_name               = "market-maker"
  float_amount                = 450000000 # 1000n * 10n ** 6n
  spread_amount               = 10000     # 2n * 10n ** 4n
  grid_levels                 = 5
  active_quoting_amount_ratio = 0.6
  risk_aversion               = 15000          
  loop_interval_ms            = 15000
  max_position                = 10
  log_level                   = "info"
  chain_id                    = 42161
}

margin_call_lambda = {
  create                             = true
  log_level                          = "debug"
  job_interval                       = "15"
  timeout                            = 300
  memory_size                        = 512
  margin_utilization_warning_percent = "80"
  daily_schedule_hour                = "0"           # UTC hour (0-23). Examples: 0=midnight UTC, 14=09:00 EST/10:00 EDT, 21=16:00 EST/17:00 EDT
  daily_schedule_minute              = "0"           # UTC minute (0-59)
}

notifications_service = {
  create                     = true
  protect                    = false
  ntf_imagetag               = "stg-latest"
  ntf_ghcr_repo              = "ghcr.io/lumerin-protocol/futures-notifications"
  svc_name                   = "futures-notifications"
  cnt_name                   = "futures-notifications"
  cnt_port                   = 3000
  task_cpu                   = 256
  task_ram                   = 512
  task_worker_qty            = 1
  friendly_name              = "notifications"
  db_instance_class          = "db.t3.micro"
  db_allocated_storage       = 20
  db_max_allocated_storage   = 50
  db_max_connections         = "100"
  db_backup_retention_period = 7
  db_backup_window           = "03:00-04:00"
  db_maintenance_window      = "sun:04:00-sun:05:00"
  alb_internal               = true
  alb_name                   = "notifyint."
}

########################################
# Shared Contract Addresses
########################################
# Note: ethereum_rpc_url is defined in secret.auto.tfvars (contains API key)
# Contract addresses for the environment
# DEV uses Arbitrum Sepolia testnet, STG/LMN use Arbitrum mainnet
clone_factory_address   = "0xb5838586b43b50f9a739d1256a067859fe5b3234"
hashrate_oracle_address = "0x2c1db79d2f3df568275c940dac81ad251871faf4"
futures_address         = "0xe11594879beb6c28c67bc251aa5e26ce126b82ba"
multicall_address       = "0xcA11bde05977b3631167028862bE2a173976CA11"

########################################
# Monitoring Configuration
########################################
monitoring = {
  create                    = true  # Services not deployed in STG yet
  create_alarms             = true
  create_dashboards         = true
  create_metric_filters     = true
  create_synthetics_canary  = true
  notifications_enabled     = true
  dev_alerts_topic_name     = "titanio-stg-dev-alerts"
  devops_alerts_topic_name  = "titanio-stg-dev-alerts"
  dashboard_period          = 300
}

# STG environment - moderate frequency
monitoring_schedule = {
  synthetics_canary_rate_minutes = 30  # Run canary every 30 min
  unhealthy_alarm_period_minutes = 30  # How long to tolerate "bad" before alarm triggers
}

# STG environment - moderate thresholds (for when services are deployed)
alarm_thresholds = {
  ecs_cpu_threshold           = 85
  ecs_memory_threshold        = 85
  ecs_min_running_tasks       = 1
  lambda_error_threshold      = 3
  lambda_duration_threshold   = 240000
  lambda_throttle_threshold   = 5
  alb_5xx_threshold           = 10
  alb_unhealthy_threshold     = 1
  alb_latency_threshold       = 10
  rds_cpu_threshold           = 85
  rds_storage_threshold       = 5
  rds_connections_threshold   = 85
  cloudfront_5xx_threshold    = 3
  cloudfront_4xx_threshold    = 8
}

########################################
# Account metadata
########################################
provider_profile  = "titanio-stg"  # Local account profile ... should match account_shortname..kept separate for future ci/cd
account_shortname = "titanio-stg"  # shortname account code 7 digit + 3 digit eg: titanio-mst, titanio-inf, or rhodium-prd
account_number    = "464450398935" # 12 digit account number 
account_lifecycle = "stg"          # [sbx, dev, stg, prd] -used for NACL and other reference
default_region    = "us-east-1"
region_shortname  = "use1"

########################################
# Environment Specific Variables
#######################################
vpc_index            = 1
devops_keypair       = "bedrock-titanio-stg-use1"
titanio_net_edge_vpn = "172.18.16.0/20"
protect_environment  = false
ecs_task_role_arn    = "arn:aws:iam::464450398935:role/ecsTaskExecutionRole" # "arn:aws:iam::330280307271:role/services/bedrock-cicd-lmntkndstui" #

# Default tag values common across all resources in this account.
# Values can be overridden when configuring a resource or module.
default_tags = {
  ServiceOffering = "Cloud Foundation"
  Department      = "DevOps"
  Environment     = "stg"
  Owner           = "aws-titanio-stg@titan.io" #AWS Account Email Address 092029861612 | aws-sandbox@titan.io | OrganizationAccountAccessRole 
  Scope           = "Global"
  CostCenter      = null
  Compliance      = null
  Classification  = null
  Repository      = "https://github.com/Lumerin-protocol/futures-marketplace.git//bedrock/03-stg"
  ManagedBy       = "Terraform"
}

# Default Tags for Cloud Foundation resources
foundation_tags = {
  Name          = null
  Capability    = null
  Application   = "Lumerin Futures Marketplace - STG"
  LifecycleDate = null
}
