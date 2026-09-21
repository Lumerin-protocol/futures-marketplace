################################################################################
# APP-SPECIFIC GLOBAL LOOKUPS (data files, dns, iam, etc...)
################################################################################

################################################################################
# DEVOPS/BEDROCK SOURCE INFO
################################################################################
data "local_file" "maintenance" { filename = "manage/lumerin-maintenance.html" }
data "local_file" "coming_soon" { filename = "manage/mktplc-coming-soon.html" }
locals {
  # maintenance_mode       = false
  # coming_soon_mode       = false
  # x_custom_header_bypass = "P4fVAfRcwjaiyrcepvf4PDZW"
}
################################
# WAF Protection - for Cloudfront (Global Scope)
################################
data "aws_wafv2_web_acl" "bedrock_waf_cloudfront" {
  provider = aws.use1
  name     = "waf-bedrock-cloudfront"
  scope    = "CLOUDFRONT"
}

################################
# Legacy lumerin.io zones (S3 bucket name + CF log prefix only)
#
# Public hostnames, ACM, and Route53 use Hashpower (local.hp_dns / local.hp_acm) below.
# Bucket names stay *.lumerin.io to avoid replacing existing buckets (branding is DNS/CF).
################################
data "aws_route53_zone" "public_lumerin_root" {
  provider     = aws.titanio-prd
  name         = "lumerin.io"
  private_zone = false
}

data "aws_route53_zone" "public_lumerin" {
  provider     = aws.use1
  name         = "${substr(var.account_shortname, 8, 3)}.lumerin.io"
  private_zone = false
}

locals {
  marketplace_s3_domain_suffix = var.account_lifecycle == "prd" ? data.aws_route53_zone.public_lumerin_root.name : data.aws_route53_zone.public_lumerin.name
}

################################
# Hashpower DNS & ACM Lookups
#
# Conditional: lmn resolves root domains, dev/stg resolve env subdomains.
# Dependent code uses the same local reference regardless of account.
#
# Usage:
#   DNS zone:
#     local.hp_dns["exc"].zone_id
#     local.hp_dns["exc"].name   # zone apex: hashpower.exchange | dev.hashpower.exchange | stg.hashpower.exchange (public site is this host, not futures.*)
#     local.hp_dns["tok"].zone_id
#
#   ACM cert:
#     local.hp_acm["exc"].arn
#     local.hp_acm["tok"].arn
#
#   Keys: exc = hashpower.exchange, tok = hpow.io, com = hashpower.io (when acquired)
################################
locals {
  env_prefix = substr(var.account_shortname, 8, 3)
  is_lmn     = local.env_prefix == "lmn"

  hashpower_domains = {
    exc = "hashpower.exchange"
    tok = "hpow.io"
    # com = "hashpower.io"  # uncomment when domain is acquired
  }
}

# DNS: root zones in titanio-net (lmn only)
data "aws_route53_zone" "hp_root" {
  for_each     = local.is_lmn ? local.hashpower_domains : {}
  provider     = aws.titanio-net
  name         = each.value
  private_zone = false
}

# DNS: env subdomain zones in local account (dev, stg)
data "aws_route53_zone" "hp_env" {
  for_each     = local.is_lmn ? {} : local.hashpower_domains
  provider     = aws.use1
  name         = "${local.env_prefix}.${each.value}"
  private_zone = false
}

# ACM: always in local account, domain conditional on env
data "aws_acm_certificate" "hp" {
  for_each = local.hashpower_domains
  provider = aws.use1
  domain   = local.is_lmn ? each.value : "${local.env_prefix}.${each.value}"
  statuses = ["ISSUED"]
}

locals {
  hp_dns = local.is_lmn ? data.aws_route53_zone.hp_root : data.aws_route53_zone.hp_env
  hp_acm = data.aws_acm_certificate.hp
}

output "hp_dns" {
  value = { for k, v in local.hp_dns : k => { zone_id = v.zone_id, name = v.name } }
}

output "hp_acm" {
  # aws_acm_certificate has no domain_name attribute; domain matches the lookup above
  value = { for k, v in local.hp_acm : k => {
    arn    = v.arn
    domain = local.is_lmn ? local.hashpower_domains[k] : "${local.env_prefix}.${local.hashpower_domains[k]}"
  } }
}

