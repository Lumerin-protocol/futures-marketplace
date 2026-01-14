
################################################################################
# OUTPUTS - # Usage: terragrunt output github_actions_role_arn
################################################################################
output "github_actions_role_arn" {
  description = "ARN of the IAM role for GitHub Actions (used by all services)"
  value       = (var.create_marketplace_s3cf) ? aws_iam_role.github_actions_futures[0].arn : null
}
output "github_actions_role_name" {
  description = "Name of the IAM role for GitHub Actions"
  value       = var.create_marketplace_s3cf ? aws_iam_role.github_actions_futures[0].name : null
}
output "marketplace_s3_bucket" {
  description = "S3 bucket name for marketplace deployment"
  value       = var.create_marketplace_s3cf ? aws_s3_bucket.marketplace[0].id : null
}
output "marketplace_cloudfront_distribution_id" {
  description = "CloudFront distribution ID for marketplace"
  value       = var.create_marketplace_s3cf ? aws_cloudfront_distribution.marketplace[0].id : null
}
output "marketplace_url" {
  description = "URL of the marketplace website"
  value       = var.create_marketplace_s3cf ? (var.account_lifecycle == "prd" ? "https://${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin_root.name}" : "https://${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin.name}") : null
}

