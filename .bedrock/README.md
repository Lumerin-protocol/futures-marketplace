# Proxy Router - Application Foundation Services (AFS)

## Overview

This repository defines the Application Foundation Services (AFS) infrastructure for the Lumerin Proxy Router and Marketplace ecosystem using Terraform and Terragrunt.

**Dependencies:**
- Depends on: `bedrock/foundation-core` and `bedrock/foundation-extra`
- Supports: Application code deployed from separate repositories via GitHub Actions

**Infrastructure Management:**
- Dev-Sec-Ops admins run Terragrunt commands to provision and manage infrastructure per environment
- Application code is deployed separately via GitHub Actions from respective application repositories
- All environments managed from the `main` branch

## Architecture Overview

This repository provisions infrastructure for multiple services, each controlled by toggle variables in `terraform.tfvars`.

### Core Services

#### 1. Proxy Router UI (`var.create_lumerin_marketplace`)
**Frontend web application for the Lumerin Marketplace**
- Global Accelerator for resilience and distributed deployments
  - Port 443 and 80 listeners with endpoint groups
  - Route53 aliases for root and subdomains
- Regional Application Load Balancer (ALB)
  - HTTPS/HTTP listeners with custom maintenance/coming-soon bypass rules
  - AWS WAF/Shield integration for DDoS protection
- ECS Fargate Service
  - Task Definition pulls container from GitHub Container Registry
  - Auto-scaling and health checks
  - CloudWatch logging

#### 2. Lumerin Marketplace Services (`var.create_lumerin_mktplc_svc`)
**Backend marketplace services**
- ECS Fargate service for marketplace API
- RDS PostgreSQL database
- Internal ALB for service communication
- CloudWatch monitoring and logging

#### 3. Lumerin Indexer (`var.create_lumerin_indexer`)
**Blockchain event indexer**
- ECS Fargate service
- Caches blockchain events for fast querying
- CloudWatch logging

#### 4. Marketplace Website (`var.create_marketplace_s3cf`)
**Static website hosting**
- S3 bucket for static assets
- CloudFront distribution with custom domain
- Route53 DNS records

#### 5. Oracle Lambda (`var.create_oracle_lambda`)
**Price oracle service for smart contracts**
- Lambda function with VPC access
- EventBridge schedule (configurable interval)
- Updates on-chain hashrate and BTC price data
- CloudWatch alarms and logging
- Secrets Manager integration

#### 6. Notifications Service (`var.create_notifications_service`)
**Real-time notifications via Telegram bot**
- ECS Fargate service with Telegram bot integration
- RDS PostgreSQL database
- Internal ALB for Lambda communication
- CloudWatch monitoring

#### 7. Margin Call Lambda (`var.create_margin_call_lambda`)
**Automated margin call monitoring**
- Lambda function with VPC access
- EventBridge schedule (every 15 minutes)
- Monitors futures contracts for liquidation
- CloudWatch alarms and logging

#### 8. Subgraph Indexer (`var.create_subgraph_indexer`)
**The Graph protocol node for GraphQL API**
- Graph Node ECS service
- IPFS ECS service with EFS persistent storage
- RDS PostgreSQL database
- External ALB for public GraphQL queries
- Service discovery for internal communication

#### 9. GitHub Actions IAM (`var.create_github_actions_iam`)
**CI/CD infrastructure access**
- OIDC provider for GitHub Actions
- IAM roles with least-privilege policies
- Environment-specific branch filters
- Enables GitHub Actions workflows to deploy application code

### Common Infrastructure Components

All services leverage shared infrastructure from `bedrock/foundation-core` and `bedrock/foundation-extra`:
- VPC with public, private, and database subnets across multiple AZs
- Security groups with least-privilege access
- AWS WAF and Shield for DDoS protection
- CloudWatch log groups with configurable retention
- Secrets Manager for sensitive configuration
- Route53 hosted zones for DNS management
- ACM certificates for HTTPS

## Repository Structure

### Terragrunt Configuration

```
proxy-ui-foundation/
├── .terragrunt/              # Shared Terraform modules (all service definitions)
│   ├── 00_variables.tf       # Variable definitions
│   ├── 00_variables_local.tf # Computed local values
│   ├── 00_providers.tf       # AWS provider configuration
│   ├── 00_data_*.tf          # Data source lookups
│   ├── 01_secrets_manager.tf # Centralized secrets
│   ├── 02_proxy_*.tf         # Proxy Router UI services
│   ├── 03_lumerin_*.tf       # Marketplace services
│   ├── 04_market_*.tf        # Static website
│   ├── 05_oracle_lambda.tf   # Oracle Lambda
│   ├── 06_notifications_*.tf # Notifications service
│   ├── 07_margin_call_*.tf   # Margin Call Lambda
│   ├── 08_subgraph_*.tf      # Subgraph indexer
│   └── 09_github_actions_*.tf# GitHub Actions IAM
├── 02-dev/                   # Development environment
│   ├── terragrunt.hcl        # References ../root.hcl
│   ├── terraform.tfvars      # Dev-specific configuration
│   ├── secret.auto.tfvars    # Sensitive values (gitignored)
│   └── dnsprovider.tf        # Route53 zone reference
├── 03-stg/                   # Staging environment
├── 04-lmn/                   # Production (Lumerin) environment
├── .ai-docs/                 # Architecture documentation
├── root.hcl                  # Terragrunt backend config
└── README.md                 # This file
```

### Environment-Specific Configuration

Each environment folder (`02-dev`, `03-stg`, `04-lmn`) contains:

1. **`terragrunt.hcl`** - References `root.hcl` and `.terragrunt/` source
2. **`terraform.tfvars`** - Environment-specific settings:
   - Toggle switches for each service
   - Resource sizing (CPU, memory, storage)
   - Domain names and DNS configuration
   - Contract addresses and RPC endpoints
   - Scaling parameters
3. **`secret.auto.tfvars`** - Sensitive values (gitignored):
   - API keys (Ethereum RPC URLs)
   - Telegram bot tokens
   - Database credentials
4. **`dnsprovider.tf`** - Route53 hosted zone data sources

## Deployment Workflow

### Infrastructure Management (Terragrunt)

Dev-Sec-Ops administrators manage infrastructure using Terragrunt:

```bash
# Navigate to environment directory
cd 02-dev/  # or 03-stg/ or 04-lmn/

# Plan infrastructure changes
terragrunt plan

# Apply infrastructure changes (requires approval)
terragrunt apply

# View outputs
terragrunt output
```

### Application Deployment (GitHub Actions)

Application code is deployed separately from their respective repositories:

1. **Developers** push code to GitHub repositories:
   - `proxy-router-ui` → ECS tasks updated via GitHub Actions
   - `proxy-smart-contracts` → Lambda functions updated via GitHub Actions
   - Each repo has workflows that use GitHub OIDC to authenticate to AWS

2. **GitHub Actions workflows** automatically:
   - Build Docker images or Lambda packages
   - Push to container registries (GHCR, ECR)
   - Update ECS services or Lambda functions
   - No manual intervention required

3. **Environment-specific deployments** controlled by branch:
   - `dev` → deploys to DEV environment
   - `test` → deploys to STG environment  
   - `main` → deploys to LMN (production) environment

### Branch Strategy

- **Single `main` branch** for infrastructure code
- Infrastructure changes are environment-agnostic
- Environment selection via Terragrunt directory (`02-dev/`, `03-stg/`, `04-lmn/`)
- No need for separate dev/stg/main branches

## Key Features

### DRY Principles
- Shared infrastructure defined once in `.terragrunt/`
- Environment-specific values in `terraform.tfvars`
- No duplication across environments

### Security
- Secrets stored in AWS Secrets Manager
- OIDC authentication (no long-lived credentials)
- Least-privilege IAM policies
- VPC isolation for sensitive services
- AWS WAF/Shield for DDoS protection

### Cost Optimization
- Toggle switches to disable unused services
- Right-sized resources per environment
- Configurable retention periods
- Auto-scaling capabilities

### Observability
- CloudWatch Logs for all services
- CloudWatch Alarms for critical metrics
- Structured logging with JSON format
- Centralized monitoring

## Documentation

Detailed documentation available in `.ai-docs/`:
- `DEPLOYMENT_GUIDE.md` - Step-by-step deployment instructions
- `ARCHITECTURAL_IMPROVEMENTS.md` - Design decisions and patterns
- `SECRETS_SECURITY.md` - Secrets management best practices
- `GITHUB_OIDC_CONFIGURATION.md` - CI/CD setup guide
- `CONTRACT_ADDRESSES_SUMMARY.md` - Smart contract addresses
- `SHARED_VARIABLES.md` - Variable reference
- `STANDARDIZED_NAMING.md` - Naming conventions

## Prerequisites

- AWS CLI configured with appropriate profiles
- Terraform >= 1.5.0
- Terragrunt >= 0.48.0
- Access to AWS accounts:
  - `titanio-dev` (434960487817)
  - `titanio-stg` 
  - `titanio-mst` (production)
- Existing base infrastructure from `bedrock/foundation-core`

## Support

For questions or issues:
1. Check CloudWatch Logs for service-specific errors
2. Review `.ai-docs/` for architecture details
3. Verify security groups and IAM permissions
4. Consult Terragrunt/Terraform documentation


