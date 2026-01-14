################################################################################
# SECRETS MANAGER
################################################################################
# AWS Secrets Manager resources for sensitive variables


################################################################################
# FUTURES MARKETPLACE SECRETS (COMBINED)
################################################################################
# Single secret containing all futures marketplace secrets
# This includes both sensitive values (API keys, tokens) and AWS resource identifiers
# AWS resource IDs are stored here to prevent manual transcription errors in GitHub

resource "aws_secretsmanager_secret" "futures" {
  count       = (var.create_marketplace_s3cf) ? 1 : 1
  name        = "futures-marketplace-secrets-v3-${substr(var.account_shortname, 8, 3)}"
  description = "Combined secrets for Futures Marketplace services and deployment configuration"
  tags = merge(var.default_tags, var.foundation_tags, {
    Name = "futures-marketplace-secrets-v3"
  })
}

resource "aws_secretsmanager_secret_version" "futures" {
  count = ( var.create_marketplace_s3cf) ? 1 : 1
  # lifecycle {
  #   ignore_changes = [secret_string]
  # }
  secret_id = aws_secretsmanager_secret.futures[count.index].id
  secret_string = jsonencode({
    # Sensitive values (API keys, tokens)
    # AWS deployment configuration (auto-populated by Terraform)
    # These values are read by GitHub Actions to prevent manual transcription errors
    deployment = {
      s3_bucket                  = var.create_marketplace_s3cf ? aws_s3_bucket.marketplace[0].id : ""
      cloudfront_distribution_id = var.create_marketplace_s3cf ? aws_cloudfront_distribution.marketplace[0].id : ""
      marketplace_url            = var.create_marketplace_s3cf ? (var.account_lifecycle == "prd" ? "https://${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin_root.name}" : "https://${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin.name}") : ""
      aws_region                 = var.default_region
      environment                = var.account_lifecycle
    }
  })
}

