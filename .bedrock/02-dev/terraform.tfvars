#Create Switches for Lumerin Marketplace and Indexer / proxy-router-ui  
create_core = true

ecs_cluster = {
  create  = true
  protect = false
}

# Configure Market Maker Lambda
market_maker = {
  create                      = true
  # Lambda Configuration
  timeout                     = 60          # 60 seconds (enough for blockchain tx)
  memory_size                 = 1024        # 1GB RAM
  schedule_rate               = 1           # Run every 1 minute
  # Trading Parameters
  float_amount                = 300000000   # 300 USDC (300n * 10n ** 6n)
  spread_amount               = 10000       # 0.01 USDC (1n * 10n ** 4n)
  grid_levels                 = 5
  active_quoting_amount_ratio = 0.4
  risk_aversion               = 3000000     # Risk aversion parameter (higher = more conservative)
  max_position                = 10
  log_level                   = "info"
  chain_id                    = 421614      # Arbitrum Sepolia
  # Balance Thresholds (graceful exit when funds low)
  min_eth_balance             = "100000000000000"     # 0.0001 ETH in wei (~1.4 txns - stops before failing)
  min_usdc_balance            = "10000000"            # 10 USDC (10n * 10n ** 6n)
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
  ntf_imagetag               = "dev-latest"
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
clone_factory_address   = "0x998135c509b64083cd27ed976c1bcda35ab7a40b"
hashrate_oracle_address = "0x6f736186d2c93913721e2570c283dff2a08575e9"
futures_address         = "0xec76867e96d942282fc7aafe3f778de34d41a311"
multicall_address       = "0xcA11bde05977b3631167028862bE2a173976CA11"

########################################
# Monitoring Configuration
########################################
monitoring = {
  create                    = true
  create_alarms             = true
  create_dashboards         = true
  create_metric_filters     = true
  create_synthetics_canary  = true  # Canary only in production
  notifications_enabled     = true  # Disabled to reduce noise in dev
  dev_alerts_topic_name     = "titanio-dev-dev-alerts"
  devops_alerts_topic_name  = "titanio-dev-dev-alerts"
  dashboard_period          = 300
}

# DEV environment
monitoring_schedule = {
  synthetics_canary_rate_minutes = 60  # If canary enabled, run every 60 min
  unhealthy_alarm_period_minutes = 60  # How long to tolerate "bad" before alarm triggers
}

# DEV environment - relaxed thresholds
alarm_thresholds = {
  ecs_cpu_threshold           = 90
  ecs_memory_threshold        = 90
  ecs_min_running_tasks       = 1
  lambda_error_threshold      = 5
  lambda_duration_threshold   = 240000  # 80% of 300s timeout
  lambda_throttle_threshold   = 10
  alb_5xx_threshold           = 20
  alb_unhealthy_threshold     = 1
  alb_latency_threshold       = 15
  rds_cpu_threshold           = 90
  rds_storage_threshold       = 5
  rds_connections_threshold   = 90
  cloudfront_5xx_threshold    = 5
  cloudfront_4xx_threshold    = 10
}

########################################
# Account metadata
########################################
provider_profile  = "titanio-dev"  # Local account profile ... should match account_shortname..kept separate for future ci/cd
account_shortname = "titanio-dev"  # shortname account code 7 digit + 3 digit eg: titanio-mst, titanio-inf, or rhodium-prd
account_number    = "434960487817" # 12 digit account number 
account_lifecycle = "dev"          # [sbx, dev, stg, prd] -used for NACL and other reference
default_region    = "us-east-1"
region_shortname  = "use1"

########################################
# Environment Specific Variables
#######################################
vpc_index            = 1
devops_keypair       = "bedrock-titanio-dev-use1"
titanio_net_edge_vpn = "172.18.16.0/20"
protect_environment  = false
ecs_task_role_arn    = "arn:aws:iam::434960487817:role/ecsTaskExecutionRole" # "arn:aws:iam::330280307271:role/services/bedrock-cicd-lmntkndstui" #

# Default tag values common across all resources in this account.
# Values can be overridden when configuring a resource or module.
default_tags = {
  ServiceOffering = "Cloud Foundation"
  Department      = "DevOps"
  Environment     = "dev"
  Owner           = "aws-titanio-dev@titan.io" #AWS Account Email Address 092029861612 | aws-sandbox@titan.io | OrganizationAccountAccessRole 
  Scope           = "Global"
  CostCenter      = null
  Compliance      = null
  Classification  = null
  Repository      = "https://github.com/Lumerin-protocol/futures-marketplace.git//bedrock/02-dev"
  ManagedBy       = "Terraform"
}

# Default Tags for Cloud Foundation resources
foundation_tags = {
  Name          = null
  Capability    = null
  Application   = "Lumerin Futures Marketplace - DEV"
  LifecycleDate = null
}
