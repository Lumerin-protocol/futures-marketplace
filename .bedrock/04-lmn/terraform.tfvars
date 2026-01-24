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
  subgraph_url_futures        = "https://graph.lmn.lumerin.io/subgraphs/name/futures"
  subgraph_url_oracles        = "https://graph.lmn.lumerin.io/subgraphs/name/oracles"
  subgraph_api_key            = ""
  float_amount                = 1000000000  
  spread_amount               = 10000      
  grid_levels                 = 5
  active_quoting_amount_ratio = 0.4
  risk_aversion               = 15000       
  loop_interval_ms            = 15000   
  max_position                = 10
  log_level                   = "info"
  chain_id                    = 42161
}

margin_call_lambda = {
  create                             = true
  log_level                          = "info"
  job_interval                       = "15"
  timeout                            = 300
  memory_size                        = 1024
  margin_utilization_warning_percent = "80"
  daily_schedule_hour                = "0"           # UTC hour (0-23). Examples: 0=midnight UTC, 14=09:00 EST/10:00 EDT, 21=16:00 EST/17:00 EDT
  daily_schedule_minute              = "0"           # UTC minute (0-59)
  subgraph_api_key                   = "self-hosted" # Self-hosted Graph Node doesn't require API key, but validation requires non-empty string
  futures_subgraph_url               = "https://graph.lmn.lumerin.io/subgraphs/name/futures"
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
  db_instance_class          = "db.t3.small"
  db_allocated_storage       = 50
  db_max_allocated_storage   = 100
  db_max_connections         = "200"
  db_backup_retention_period = 30
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
clone_factory_address   = "0x6b690383c0391b0cf7d20b9eb7a783030b1f3f96"
hashrate_oracle_address = "0x6599ef8e2b4a548a86eb82e2dfbc6ceadfceacbd"
futures_address         = "0x8464dc5ab80e76e497fad318fe6d444408e5ccda" 
multicall_address       = "0xcA11bde05977b3631167028862bE2a173976CA11"

########################################
# Monitoring Configuration
########################################
monitoring = {
  create                    = false  # Services not deployed in LMN yet
  create_alarms             = false
  create_dashboards         = false
  create_metric_filters     = false
  create_synthetics_canary  = false  # Enable when services deployed (true for production)
  notifications_enabled     = false  # Enable when services deployed (true for production)
  dev_alerts_topic_name     = "titanio-lmn-dev-alerts"      # Slack
  devops_alerts_topic_name  = "titanio-lmn-devops-alerts"   # Cell phone (critical)
  dashboard_period          = 300
}

# LMN/PROD environment - strict thresholds
alarm_thresholds = {
  ecs_cpu_threshold           = 80
  ecs_memory_threshold        = 85
  ecs_min_running_tasks       = 1
  lambda_error_threshold      = 1
  lambda_duration_threshold   = 240000
  lambda_throttle_threshold   = 1
  alb_5xx_threshold           = 5
  alb_unhealthy_threshold     = 1
  alb_latency_threshold       = 5
  rds_cpu_threshold           = 80
  rds_storage_threshold       = 10
  rds_connections_threshold   = 80
  cloudfront_5xx_threshold    = 1
  cloudfront_4xx_threshold    = 5
}

########################################
# Account metadata
########################################
provider_profile  = "titanio-lmn"  # Local account profile ... should match account_shortname..kept separate for future ci/cd
account_shortname = "titanio-lmn"  # shortname account code 7 digit + 3 digit eg: titanio-mst, titanio-inf, or rhodium-prd
account_number    = "330280307271" # 12 digit account number 
account_lifecycle = "prd"          # [sbx, dev, stg, prd] -used for NACL and other reference
default_region    = "us-east-1"
region_shortname  = "use1"

########################################
# Environment Specific Variables
#######################################
vpc_index            = 1
devops_keypair       = "bedrock-titanio-lmn-use1"
titanio_net_edge_vpn = "172.18.16.0/20"
protect_environment  = false
ecs_task_role_arn    = "arn:aws:iam::330280307271:role/ecsTaskExecutionRole" # "arn:aws:iam::330280307271:role/services/bedrock-cicd-lmntkndstui" #

# Default tag values common across all resources in this account.
# Values can be overridden when configuring a resource or module.
default_tags = {
  ServiceOffering = "Cloud Foundation"
  Department      = "DevOps"
  Environment     = "lmn"
  Owner           = "aws-titanio-lmn@titan.io" #AWS Account Email Address 092029861612 | aws-sandbox@titan.io | OrganizationAccountAccessRole 
  Scope           = "Global"
  CostCenter      = null
  Compliance      = null
  Classification  = null
  Repository      = "https://github.com/Lumerin-protocol/futures-marketplace.git//bedrock/04-lmn"
  ManagedBy       = "Terraform"
}

# Default Tags for Cloud Foundation resources
foundation_tags = {
  Name          = null
  Capability    = null
  Application   = "Lumerin Futures Marketplace - LMN"
  LifecycleDate = null
}
