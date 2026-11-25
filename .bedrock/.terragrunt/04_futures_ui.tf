################################
# S3 Bucket  for Marketplace Website 
################################
resource "aws_s3_bucket" "marketplace" {
  count    = var.create_core ? 1 : 0
  provider = aws.use1
  bucket   = "${local.s3_cf_origin}.${local.marketplace_s3_domain_suffix}"
  lifecycle {
    prevent_destroy = false
  }
  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Capability = "S3 Bucket",
    },
  )
}

# Enable Bucket Versioning 
resource "aws_s3_bucket_versioning" "marketplace" {
  count    = var.create_core ? 1 : 0
  provider = aws.use1
  bucket   = aws_s3_bucket.marketplace[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "marketplace" {
  count    = var.create_core ? 1 : 0
  provider = aws.use1
  bucket   = aws_s3_bucket.marketplace[0].id
  policy   = data.aws_iam_policy_document.s3_marketplace[0].json
}

data "aws_iam_policy_document" "s3_marketplace" {
  count    = var.create_core ? 1 : 0
  provider = aws.use1
  statement {
    sid = "AllowCloudFrontServicePrincipal"
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions = [
      "s3:GetObject",
    ]
    resources = [

      "${aws_s3_bucket.marketplace[0].arn}/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceARN"
      values = concat(
        [aws_cloudfront_distribution.marketplace[0].arn],
        var.beta_alias.create ? [aws_cloudfront_distribution.beta_alias[0].arn] : [],
      )
    }
  }
}

resource "aws_s3_bucket_public_access_block" "marketplace" {
  count                   = var.create_core ? 1 : 0
  provider                = aws.use1
  bucket                  = aws_s3_bucket.marketplace[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "marketplace" {
  count    = var.create_core ? 1 : 0
  provider = aws.use1
  bucket   = aws_s3_bucket.marketplace[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}


################################
# GLOBAL CloudFront and DNS 
################################

# Create CloudFront Distribution: 
resource "aws_cloudfront_distribution" "marketplace" {
  count    = var.create_core ? 1 : 0
  provider = aws.use1
  origin {
    domain_name              = local.marketplace_origin_domain
    origin_access_control_id = local.marketplace_origin_oac_id
    origin_id                = local.marketplace_origin_id
  }
  depends_on = [aws_s3_object.apex_hold]
  # Hold page keeps the shared ACL. This distribution uses the exchange ACL
  # when it serves the app (apex_site "app") and exchange_geo_block is on.
  http_version     = "http2and3"
  web_acl_id       = var.exchange_geo_block && var.apex_site != "hold" ? aws_wafv2_web_acl.exchange[0].arn : data.aws_wafv2_web_acl.bedrock_waf_cloudfront.arn
  retain_on_delete = true
  enabled          = true
  is_ipv6_enabled  = true
  # Public URL is zone apex only: hashpower.exchange | dev.hashpower.exchange | stg.hashpower.exchange (no futures. subdomain)
  comment             = "${local.hp_dns["exc"].name} marketplace"
  default_root_object = "index.html"
  aliases             = local.marketplace_aliases
  price_class         = "PriceClass_200" #200=all except SouthAmerica, Australia/NZ, 100=NA/EMEA only All=All
  logging_config {
    include_cookies = false
    bucket          = "${var.account_shortname}-devops.s3.amazonaws.com"
    prefix          = "${local.s3_cf_origin}.${local.marketplace_s3_domain_suffix}."
  }
  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = local.marketplace_origin_id
    # Hold page keeps the legacy cache settings. The trading app uses a cache policy
    # so the geo function can see viewer country without splitting the cache by country.
    dynamic "forwarded_values" {
      for_each = local.exchange_marketplace_stamps_geo ? [] : [1]
      content {
        query_string = false
        cookies {
          forward = "none"
        }
      }
    }
    cache_policy_id          = local.exchange_marketplace_stamps_geo ? aws_cloudfront_cache_policy.exchange[0].id : null
    origin_request_policy_id = local.exchange_marketplace_stamps_geo ? aws_cloudfront_origin_request_policy.exchange_geo[0].id : null
    compress                 = local.exchange_marketplace_stamps_geo
    viewer_protocol_policy   = "redirect-to-https" # "allow-all" was default or redirect-to-https
    min_ttl                  = local.exchange_marketplace_stamps_geo ? null : 0
    default_ttl              = local.exchange_marketplace_stamps_geo ? null : 600
    max_ttl                  = local.exchange_marketplace_stamps_geo ? null : 1200
    dynamic "function_association" {
      for_each = local.exchange_marketplace_stamps_geo ? [1] : []
      content {
        event_type   = "viewer-response"
        function_arn = aws_cloudfront_function.exchange_geo[0].arn
      }
    }
  }
  restrictions {
    geo_restriction {
      restriction_type = "none" # "whitelist"
      #   locations        = ["US", "CA", "GB", "DE"]
    }
  }
  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Capability = "CloudFront Distribution",
    },
  )
  dynamic "viewer_certificate" {
    for_each = length(local.marketplace_aliases) > 0 ? [1] : []
    content {
      acm_certificate_arn      = data.aws_acm_certificate.lumerin_marketplace_website.arn
      minimum_protocol_version = "TLSv1.2_2021"
      ssl_support_method       = "sni-only"
    }
  }
  dynamic "viewer_certificate" {
    for_each = length(local.marketplace_aliases) == 0 ? [1] : []
    content {
      cloudfront_default_certificate = true
    }
  }
  custom_error_response {
    error_caching_min_ttl = "300"
    error_code            = "400"
    response_code         = "200"
    response_page_path    = "/index.html"
  }
  # SPA fallback for a missing object. A WAF block is not rewritten.
  # CloudFront geo_restriction returns a 403 that this rule would turn back into the app.
  custom_error_response {
    error_caching_min_ttl = "300"
    error_code            = "403"
    response_code         = "200"
    response_page_path    = "/index.html"
  }
}

resource "aws_cloudfront_origin_access_control" "marketplace" {
  count                             = var.create_core ? 1 : 0
  provider                          = aws.use1
  name                              = "${var.account_shortname}-${local.s3_cf_origin}"
  description                       = "${local.s3_cf_origin} CF Access Control"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

################################
# Exchange geo classification
#
# The trading app always loads. A viewer-response function sets hpdx_allowed
# to 1 or 0 from CloudFront's viewer country headers. The WAF only counts, so the
# block page is gone and the UI can show a banner.
#
# Which distribution serves the trading app:
#   apex_site "app"  - marketplace distribution. Dev leaves exchange_geo_block off
#                      and the function always sets hpdx_allowed=1.
#   apex_site "hold" - beta distribution
#   apex_site "beta" - same beta distribution; the apex alias is added there
# Cutover does not move the function or the ACL.
#
# Do not apply the LMN change until the UI treats anything except hpdx_allowed=1 as not allowed.
# Until that UI is on beta, count mode lets sanctioned countries use the app.
################################
locals {
  exchange_marketplace_stamps_geo = var.apex_site != "hold"
  # ISO 3166-1 alpha-2. US territories are separate codes from US.
  exchange_blocked_countries = ["US", "PR", "GU", "VI", "AS", "MP", "CU", "IR", "KP", "SY"]
  # CloudFront-Viewer-Country-Region is the subdivision only (ON, 43), not CA-ON.
  # WAF labels are awswaf:clientip:geo:region:<country>-<region>.
  # Crimean addresses that MaxMind codes as Russia are not covered; Russia is not blocked.
  exchange_blocked_regions = [
    { country = "CA", region = "ON" }, # Ontario
    { country = "UA", region = "43" }, # Crimea
    { country = "UA", region = "40" }, # Sevastopol
    { country = "UA", region = "14" }, # Donetsk
    { country = "UA", region = "09" }, # Luhansk
    { country = "UA", region = "65" }, # Kherson
    { country = "UA", region = "23" }, # Zaporizhzhia
  ]
}

resource "aws_wafv2_web_acl" "exchange" {
  count       = var.create_core && var.exchange_geo_block ? 1 : 0
  provider    = aws.use1
  name        = "${var.account_shortname}-exchange"
  description = "Count restricted viewers of the hashpower.exchange trading UI. The page still loads."
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "CountRestrictedCountries"
    priority = 0
    action {
      count {}
    }
    statement {
      geo_match_statement {
        country_codes = local.exchange_blocked_countries
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CountRestrictedCountries"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "CountRestrictedRegions"
    priority = 1
    action {
      count {}
    }
    statement {
      or_statement {
        dynamic "statement" {
          for_each = local.exchange_blocked_regions
          content {
            label_match_statement {
              scope = "LABEL"
              key   = "awswaf:clientip:geo:region:${statement.value.country}-${statement.value.region}"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CountRestrictedRegions"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "exchange-geo"
    sampled_requests_enabled   = true
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "${var.account_shortname}-exchange"
      Capability = "Web Application Firewall",
    },
  )
}

# Counted requests only, into the account WAF log group that already exists for waf-bedrock-cloudfront.
data "aws_cloudwatch_log_group" "bedrock_waf" {
  count    = var.create_core && var.exchange_geo_block ? 1 : 0
  provider = aws.use1
  name     = "aws-waf-logs-bedrock-use1-1"
}

resource "aws_wafv2_web_acl_logging_configuration" "exchange" {
  count                   = var.create_core && var.exchange_geo_block ? 1 : 0
  provider                = aws.use1
  log_destination_configs = [data.aws_cloudwatch_log_group.bedrock_waf[0].arn]
  resource_arn            = aws_wafv2_web_acl.exchange[0].arn

  logging_filter {
    default_behavior = "DROP"
    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ALL"
      condition {
        action_condition {
          action = "COUNT"
        }
      }
    }
  }
}

# Same TTLs as the old forwarded_values block. Query string and cookies stay out of the cache key.
resource "aws_cloudfront_cache_policy" "exchange" {
  count       = var.create_core ? 1 : 0
  provider    = aws.use1
  name        = "${var.account_shortname}-exchange-ui"
  comment     = "Static exchange UI cache. Geo headers are not part of the key."
  default_ttl = 600
  max_ttl     = 1200
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# Makes CloudFront-Viewer-Country available to the viewer-response function
# without putting the viewer's country in the cache key.
resource "aws_cloudfront_origin_request_policy" "exchange_geo" {
  count    = var.create_core ? 1 : 0
  provider = aws.use1
  name     = "${var.account_shortname}-exchange-geo"
  comment = "Viewer country headers for the hpdx_allowed cookie"

  cookies_config {
    cookie_behavior = "none"
  }
  headers_config {
    header_behavior = "whitelist"
    headers {
      items = [
        "CloudFront-Viewer-Country",
        "CloudFront-Viewer-Country-Region",
      ]
    }
  }
  query_strings_config {
    query_string_behavior = "none"
  }
}

resource "aws_cloudfront_function" "exchange_geo" {
  count    = var.create_core ? 1 : 0
  provider = aws.use1
  name     = "${var.account_shortname}-exchange-geo"
  runtime  = "cloudfront-js-2.0"
  comment  = "Set hpdx_allowed from the viewer country. 1 allows trading actions."
  publish  = true
  code = templatefile("${path.module}/manage/exchange-geo.js.tftpl", {
    geo_enabled = var.exchange_geo_block
    countries   = jsonencode(local.exchange_blocked_countries)
    regions = jsonencode([
      for pair in local.exchange_blocked_regions : "${pair.country}:${pair.region}"
    ])
  })
}

################################
# Apex hold — static page CI must not overwrite
#
# Lives only while apex_site is "hold". The marketplace distribution reads this
# bucket; the app bucket stays the beta / CI origin.
################################
resource "aws_s3_bucket" "apex_hold" {
  count    = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider = aws.use1
  bucket   = "${local.s3_cf_origin}-apex-hold.${local.marketplace_s3_domain_suffix}"
  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Capability = "S3 Bucket",
    },
  )
}

resource "aws_s3_bucket_public_access_block" "apex_hold" {
  count                   = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider                = aws.use1
  bucket                  = aws_s3_bucket.apex_hold[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "apex_hold" {
  count    = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider = aws.use1
  bucket   = aws_s3_bucket.apex_hold[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_cloudfront_origin_access_control" "apex_hold" {
  count                             = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider                          = aws.use1
  name                              = "${var.account_shortname}-${local.s3_cf_origin}-apex-hold"
  description                       = "${local.s3_cf_origin} apex hold CF Access Control"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "apex_hold" {
  count    = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider = aws.use1
  bucket   = aws_s3_bucket.apex_hold[0].id
  policy   = data.aws_iam_policy_document.s3_apex_hold[0].json
}

data "aws_iam_policy_document" "s3_apex_hold" {
  count    = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider = aws.use1
  statement {
    sid = "AllowCloudFrontServicePrincipal"
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.apex_hold[0].arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceARN"
      values   = [aws_cloudfront_distribution.marketplace[0].arn]
    }
  }
}

resource "aws_s3_object" "apex_hold" {
  count        = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider     = aws.use1
  bucket       = aws_s3_bucket.apex_hold[0].id
  key          = "index.html"
  source       = "${path.module}/manage/apex-hold.html"
  etag         = filemd5("${path.module}/manage/apex-hold.html")
  content_type = "text/html; charset=utf-8"
}

# robots.txt + sitemap for the hold bucket (used once apex DNS points here).
resource "aws_s3_object" "apex_hold_robots" {
  count        = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider     = aws.use1
  bucket       = aws_s3_bucket.apex_hold[0].id
  key          = "robots.txt"
  source       = "${path.module}/manage/apex-hold-robots.txt"
  etag         = filemd5("${path.module}/manage/apex-hold-robots.txt")
  content_type = "text/plain; charset=utf-8"
}

resource "aws_s3_object" "apex_hold_sitemap" {
  count        = var.create_core && var.apex_site == "hold" ? 1 : 0
  provider     = aws.use1
  bucket       = aws_s3_bucket.apex_hold[0].id
  key          = "sitemap.xml"
  source       = "${path.module}/manage/apex-hold-sitemap.xml"
  etag         = filemd5("${path.module}/manage/apex-hold-sitemap.xml")
  content_type = "application/xml"
}

check "apex_site_beta_has_alias" {
  assert {
    condition     = var.apex_site != "beta" || var.beta_alias.create
    error_message = "apex_site = \"beta\" requires beta_alias.create = true."
  }
}

locals {
  # hold: apex distribution reads the static bucket. app and beta: it reads the app bucket.
  marketplace_origin_domain = var.apex_site == "hold" ? one(aws_s3_bucket.apex_hold[*].bucket_regional_domain_name) : one(aws_s3_bucket.marketplace[*].bucket_regional_domain_name)
  marketplace_origin_oac_id = var.apex_site == "hold" ? one(aws_cloudfront_origin_access_control.apex_hold[*].id) : one(aws_cloudfront_origin_access_control.marketplace[*].id)
  marketplace_origin_id     = var.apex_site == "hold" ? "${var.account_shortname}-${local.s3_cf_origin}-hold" : "${var.account_shortname}-${local.s3_cf_origin}"
  # app: this distribution owns the apex name.
  # hold: leave the name on the existing coming-soon distribution.
  # beta: drop it here so the beta distribution can take it.
  marketplace_aliases = var.apex_site == "app" ? [local.hp_dns["exc"].name] : []
  # beta: apex DNS follows the beta distribution. app stays on this one.
  # hold does not write the apex record (see aws_route53_record.marketplace).
  apex_dns_name    = coalesce(var.apex_site == "beta" ? one(aws_cloudfront_distribution.beta_alias[*].domain_name) : null, one(aws_cloudfront_distribution.marketplace[*].domain_name), "unused.cloudfront.net")
  apex_dns_zone_id = coalesce(var.apex_site == "beta" ? one(aws_cloudfront_distribution.beta_alias[*].hosted_zone_id) : null, one(aws_cloudfront_distribution.marketplace[*].hosted_zone_id), "Z2FDTNDATAQYW2")
}

########## DNS — apex of the Hashpower zone → CloudFront
# special-dns is the workload account on dev and titanio-net on lmn.
# hold does not write this record: the apex A/AAAA already point at the
# coming-soon distribution in the titanio-net zone.
resource "aws_route53_record" "marketplace" {
  count           = var.create_core && var.apex_site != "hold" ? 1 : 0
  provider        = aws.special-dns
  allow_overwrite = true
  depends_on      = [aws_cloudfront_distribution.beta_alias]
  zone_id         = local.hp_dns["exc"].zone_id
  name            = ""
  type            = "A"
  alias {
    name                   = local.apex_dns_name
    zone_id                = local.apex_dns_zone_id
    evaluate_target_health = true
  }
}