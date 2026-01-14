# Futures Marketplace - Infrastructure as Code

## Overview

Terraform/Terragrunt infrastructure for the Lumerin Futures Marketplace static website.

**Dependencies:** `bedrock/foundation-core` and `bedrock/foundation-extra`

## What Gets Deployed

Controlled by `create_marketplace_s3cf` toggle in `terraform.tfvars`:

### Static Website Hosting
- **S3 Bucket** - Versioned storage for static assets
- **CloudFront Distribution** - Global CDN with:
  - HTTP/2 and HTTP/3 support
  - WAF integration
  - TLS 1.2 minimum
  - SPA routing (404/403 → index.html)
- **Route53 DNS Records**:
  - `futures.{env}.lumerin.io` (website)
  - `s3futures.{env}.lumerin.io` (origin alias)

### GitHub Actions CI/CD
- **IAM Role** - OIDC-authenticated role for GitHub Actions
- **Policies** - S3 sync and CloudFront invalidation permissions

### Secrets Manager
- **Deployment Secret** - Auto-populated config (bucket name, distribution ID, URLs) for CI/CD

## Repository Structure

```
.bedrock/
├── .terragrunt/              # Terraform modules
│   ├── 00_*.tf               # Variables, providers, data sources
│   ├── 01_secrets_manager.tf # Secrets configuration
│   ├── 02_github_actions_iam.tf # CI/CD IAM
│   └── 04_market_*.tf        # S3 + CloudFront
├── 02-dev/                   # DEV environment
├── 03-stg/                   # STG environment
├── 04-lmn/                   # PRD environment
└── root.hcl                  # Terragrunt backend config
```

## Usage

```bash
cd 02-dev/  # or 03-stg/, 04-lmn/
terragrunt plan
terragrunt apply
terragrunt output
```

## Outputs

| Output | Description |
|--------|-------------|
| `github_actions_role_arn` | IAM role ARN for GitHub Actions |
| `marketplace_s3_bucket` | S3 bucket name |
| `marketplace_cloudfront_distribution_id` | CloudFront distribution ID |
| `marketplace_url` | Website URL |

## Environment URLs

| Environment | URL |
|-------------|-----|
| DEV | `https://futures.dev.lumerin.io` |
| STG | `https://futures.stg.lumerin.io` |
| PRD | `https://futures.lumerin.io` |
