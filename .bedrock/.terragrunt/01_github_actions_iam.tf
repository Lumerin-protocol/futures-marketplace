################################################################################
# GITHUB ACTIONS IAM ROLE AND POLICIES
################################################################################
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
# OIDC PROVIDER FOR GITHUB
################################################################################
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

################################################################################
# IAM ROLE FOR GITHUB ACTIONS
################################################################################
resource "aws_iam_role" "github_actions_futures" {
  count = var.create_core ? 1 : 0
  name  = "github-actions-futures-v3-${substr(var.account_shortname, 8, 3)}"
  provider = aws.use1
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
            "token.actions.githubusercontent.com:sub" = concat(
              var.create_core ? [
                for branch_filter in local.github_branch_filter :
                "repo:Lumerin-protocol/futures-marketplace:${branch_filter}"
              ] : []
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
  count = var.create_core ? 1 : 0
  provider = aws.use1
  name  = "secrets-read-futures"
  role  = aws_iam_role.github_actions_futures[count.index].id

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
        Resource = [
          var.create_core ? aws_secretsmanager_secret.futures.arn : null, 
          var.market_maker.create ? aws_secretsmanager_secret.market_maker.arn : null,
          var.notifications_service.create ? aws_secretsmanager_secret.notifications.arn : null
       ]
      }
    ]
  })
}

################################################################################
# MARKETPLACE DEPLOYMENT POLICY (for S3 and CloudFront)
################################################################################
resource "aws_iam_role_policy" "github_marketplace_deploy" {
  count = var.create_core ? 1 : 0
  provider = aws.use1
  name  = "marketplace-deploy-s3-cloudfront"
  role  = aws_iam_role.github_actions_futures[count.index].id
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

################################################################################
# ECS UPDATE POLICY (for Market Maker and Notifications)
################################################################################
resource "aws_iam_role_policy" "github_ecs_update" {
  count = var.market_maker.create || var.notifications_service.create ? 1 : 0
  name  = "ecs-update-market-maker-and-notifications"
  role  = aws_iam_role.github_actions_futures[count.index].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "UpdateMarketMakerECSService"
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = compact([
          var.market_maker.create ? aws_ecs_service.market_maker_use1[count.index].id : null,
          var.notifications_service.create ? aws_ecs_service.notifications_use1[count.index].id : null
        ])
      },
      {
        Sid    = "TaskDefinitionOperations"
        Effect = "Allow"
        Action = [
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition"
        ]
        # These actions don't support resource-level permissions
        Resource = "*"
      },
      {
        Sid    = "PassRoleToECS"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          var.ecs_task_role_arn,
          local.titanio_role_arn
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ecs-tasks.amazonaws.com"
          }
        }
      },
      {
        Sid    = "ReadECSCluster"
        Effect = "Allow"
        Action = [
          "ecs:ListServices",
          "ecs:DescribeClusters"
        ]
        Resource = "*"
      }
    ]
  })
}

################################################################################
# LAMBDA UPDATE POLICY (for Margin Call Lambda)
################################################################################

resource "aws_iam_role_policy" "github_lambda_update" {
  count = var.margin_call_lambda.create ? 1 : 0
  name  = "lambda-update-margin-call-v2"
  role  = aws_iam_role.github_actions_futures[count.index].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "UpdateLambdaFunction"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:PublishVersion",
          "lambda:InvokeFunction" # Allow testing the Lambda function
        ]
        Resource = aws_lambda_function.margin_call[count.index].arn
      },
      {
        Sid    = "UpdateLambdaEnvironment"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionConfiguration"
        ]
        Resource = aws_lambda_function.margin_call[count.index].arn
      }
    ]
  })
}


