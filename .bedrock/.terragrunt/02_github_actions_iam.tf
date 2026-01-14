################################################################################
# GITHUB ACTIONS IAM ROLE AND POLICIES
################################################################################

################################################################################
# OIDC PROVIDER FOR GITHUB
################################################################################

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# If the OIDC provider doesn't exist, create it
# Run this once manually if needed:
# aws iam create-open-id-connect-provider \
#   --url https://token.actions.githubusercontent.com \
#   --client-id-list sts.amazonaws.com \
#   --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1b511abead59c6ce207077c0bf0e0043b1382612 \
#   --profile titanio-stg
#
# Note: Two thumbprints are recommended by GitHub for compatibility:
# - 6938fd4d98bab03faadb97b34396831e3780aea1 (legacy)
# - 1b511abead59c6ce207077c0bf0e0043b1382612 (current as of 2023)

################################################################################
# IAM ROLE FOR GITHUB ACTIONS
################################################################################

resource "aws_iam_role" "github_actions_futures" {
  count = var.create_marketplace_s3cf ? 1 : 0
  name  = "github-actions-futures-v3-${substr(var.account_shortname, 8, 3)}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = data.aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            # Allow GitHub repos:
            # 1. Lumerin-protocol/proxy-smart-contracts (services: notifications, margin-call, subgraph)
            # 2. Lumerin-protocol/proxy-router-ui (marketplace UI)
            # 3. Lumerin-protocol/proxy-indexer (spot indexer)
            # Branch filters are auto-derived based on environment lifecycle
            "token.actions.githubusercontent.com:sub" = concat(
              # Smart contracts repo (services)
              # [
              #   for branch_filter in local.github_branch_filter :
              #   "repo:${local.github_org_repo}:${branch_filter}"
              # ],
              # Router UI repo (marketplace)
              var.create_marketplace_s3cf ? [
                for branch_filter in local.github_branch_filter :
                "repo:Lumerin-protocol/futures-marketplace:${branch_filter}"
              ] : [] #,
              # # Spot Indexer repo
              # var.create_lumerin_indexer ? [
              #   for branch_filter in local.github_branch_filter :
              #   "repo:Lumerin-protocol/proxy-indexer:${branch_filter}"
              # ] : []
            )
          }
        }
      }
    ]
  })

  tags = merge(var.default_tags, var.foundation_tags, {
    Name       = "GitHub Actions - Futures Marketplace"
    Capability = "CI/CD"
  })
}

################################################################################
# SECRETS ACCESS POLICY (for reading deployment secrets and configuration)
################################################################################

resource "aws_iam_role_policy" "github_secrets_read" {
  count = var.create_marketplace_s3cf ? 1 : 0
  name  = "secrets-read-futures"
  role  = aws_iam_role.github_actions_futures[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadFuturesSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = aws_secretsmanager_secret.futures[count.index].arn
      }
    ]
  })
}

################################################################################
# MARKETPLACE DEPLOYMENT POLICY (for S3 and CloudFront)
################################################################################

resource "aws_iam_role_policy" "github_marketplace_deploy" {
  count = var.create_marketplace_s3cf ? 1 : 0
  name  = "marketplace-deploy-s3-cloudfront"
  role  = aws_iam_role.github_actions_futures[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowS3Sync"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          aws_s3_bucket.marketplace[0].arn,
          "${aws_s3_bucket.marketplace[0].arn}/*"
        ]
      },
      {
        Sid    = "AllowCloudFrontInvalidation"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
          "cloudfront:ListInvalidations"
        ]
        Resource = aws_cloudfront_distribution.marketplace[0].arn
      },
      {
        Sid    = "AllowGetDistribution"
        Effect = "Allow"
        Action = [
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig"
        ]
        Resource = aws_cloudfront_distribution.marketplace[0].arn
      }
    ]
  })
}

