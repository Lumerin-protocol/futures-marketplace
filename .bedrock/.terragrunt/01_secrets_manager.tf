################################################################################
# SECRETS MANAGER
################################################################################
# AWS Secrets Manager resources for sensitive variables

# IAM policy to allow ECS task execution role to read the graph indexer secrets
resource "aws_iam_policy" "futures_marketplace_secret_access" {
  count       = (var.create_core || var.market_maker.create) ? 1 : 0
  provider    = aws.use1
  name        = "${local.shortname}-secret-access-${substr(var.account_shortname, 8, 3)}"
  description = "Allow ECS tasks to read Futures Marketplace secrets from Secrets Manager"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = compact([
          var.create_core ? aws_secretsmanager_secret.futures.arn : "",
          var.market_maker.create ? aws_secretsmanager_secret.market_maker.arn : ""
        ])
      }
    ]
  })

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures Marketplace Secret Access Policy",
      Capability = null,
    },
  )
}

# Attach the policy to the bedrock foundation role
resource "aws_iam_role_policy_attachment" "futures_marketplace_secret_access" {
  count      = (var.create_core || var.market_maker.create) ? 1 : 0
  provider   = aws.use1
  role       = "bedrock-foundation-role"
  policy_arn = aws_iam_policy.futures_marketplace_secret_access[0].arn
}

################################################################################
# FUTURES MARKETPLACE SECRETS (COMBINED)
################################################################################
# Single secret containing all futures marketplace secrets
resource "aws_secretsmanager_secret" "futures" {
  name        = "futures-marketplace-secrets-v3-${substr(var.account_shortname, 8, 3)}"
  description = "Combined secrets for Futures Marketplace services and deployment configuration"
  tags = merge(var.default_tags, var.foundation_tags, {
    Name = "futures-marketplace-secrets-v3"
  })
}

resource "aws_secretsmanager_secret_version" "futures" {
  count = var.create_core ? 1 : 0
  # lifecycle {ignore_changes = [secret_string]}
  secret_id = aws_secretsmanager_secret.futures.id
  secret_string = jsonencode({
    # Sensitive values (API keys, tokens)
    # AWS deployment configuration (auto-populated by Terraform)
    # These values are read by GitHub Actions to prevent manual transcription errors
    deployment = {
      s3_bucket                  = var.create_core ? aws_s3_bucket.marketplace[0].id : ""
      cloudfront_distribution_id = var.create_core ? aws_cloudfront_distribution.marketplace[0].id : ""
      marketplace_url            = var.create_core ? (var.account_lifecycle == "prd" ? "https://${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin_root.name}" : "https://${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin.name}") : ""
      aws_region                 = var.default_region
      environment                = var.account_lifecycle
    }
  })
}

################################################################################
# MARKET MAKER SECRETS
################################################################################
# Separate secret for Market Maker service
# Contains private key and ETH node URL (sensitive trading credentials)

resource "aws_secretsmanager_secret" "market_maker" {
  name        = "market-maker-secrets-v3-${substr(var.account_shortname, 8, 3)}"
  description = "Secrets for Market Maker trading service (private key and ETH node URL)"
  tags = merge(var.default_tags, var.foundation_tags, {
    Name = "market-maker-secrets-v3-${substr(var.account_shortname, 8, 3)}"
  })
}

resource "aws_secretsmanager_secret_version" "market_maker" {
  count = var.market_maker.create ? 1 : 0
  # lifecycle {ignore_changes = [secret_string]}
  secret_id = aws_secretsmanager_secret.market_maker.id
  secret_string = jsonencode({
    private_key  = var.market_maker_private_key
    eth_node_url = var.market_maker_eth_node_url
  })
}
