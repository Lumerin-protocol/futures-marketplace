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
  http_version     = "http2and3"
  web_acl_id       = data.aws_wafv2_web_acl.bedrock_waf_cloudfront.arn
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
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
    viewer_protocol_policy = "redirect-to-https" # "allow-all" was default or redirect-to-https
    min_ttl                = 0
    default_ttl            = 600
    max_ttl                = 1200
    # function_association {
    #   event_type   = "viewer-request" 
    #   function_arn = "arn:aws:cloudfront::434960487817:function/rewrite-gatsby-index"
    # }
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