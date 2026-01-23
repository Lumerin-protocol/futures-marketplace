
#Create Switches for Lumerin Marketplace and Indexer / proxy-router-ui  
create_core      = true

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
  subgraph_url_futures        = "https://graph.dev.lumerin.io/subgraphs/name/futures"
  subgraph_url_oracles        = "https://graph.dev.lumerin.io/subgraphs/name/oracles"
  subgraph_api_key            = ""
  float_amount                = 300000000  # 1000n * 10n ** 6n
  spread_amount               = 10000       # 2n * 10n ** 4n
  grid_levels                 = 5
  active_quoting_amount_ratio = 0.4
  risk_aversion               = 3000000           # Risk aversion parameter (higher = more conservative)
  loop_interval_ms            = 15000
  max_position                = 10
  log_level                   = "info"
  chain_id                    = 421614
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