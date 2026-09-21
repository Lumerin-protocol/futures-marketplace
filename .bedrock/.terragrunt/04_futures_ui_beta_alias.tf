################################################################################
# Beta alias hostname (e.g. beta.hashpower.exchange) for the marketplace site
#
# Second CloudFront distribution for var.beta_alias.hostname (beta.hashpower.exchange).
# Origin is the app bucket. While apex_site is "hold", GitHub Actions publishes here
# and the apex coming-soon page is a different bucket.
#
# The certificate covers the beta hostname and the zone apex. apex_site "hold" attaches
# only the beta name. apex_site "beta" removes the apex alias from the marketplace
# distribution first (depends_on below), then attaches it here and moves the apex
# Route53 record onto this distribution.
#
# DNS for the beta hostname lives in the hashpower.exchange root zone (titanio-net).
################################################################################

# Root zone lookup — required to write validation + alias records into hashpower.exchange
data "aws_route53_zone" "hp_exchange_root" {
  count        = var.beta_alias.create ? 1 : 0
  provider     = aws.titanio-net
  name         = "hashpower.exchange"
  private_zone = false
}

################################
# ACM cert — us-east-1, DNS validated against the root zone
################################
resource "aws_acm_certificate" "beta_alias" {
  count                     = var.beta_alias.create ? 1 : 0
  provider                  = aws.use1
  domain_name               = var.beta_alias.hostname
  subject_alternative_names = [local.hp_dns["exc"].name]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = var.beta_alias.hostname
      Capability = "ACM Certificate",
    },
  )
}

resource "aws_route53_record" "beta_alias_validation" {
  for_each = var.beta_alias.create ? {
    for dvo in aws_acm_certificate.beta_alias[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  provider        = aws.titanio-net
  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.hp_exchange_root[0].zone_id
}

resource "aws_acm_certificate_validation" "beta_alias" {
  count                   = var.beta_alias.create ? 1 : 0
  provider                = aws.use1
  certificate_arn         = aws_acm_certificate.beta_alias[0].arn
  validation_record_fqdns = [for r in aws_route53_record.beta_alias_validation : r.fqdn]
}

################################
# CloudFront distribution — shares the existing marketplace S3 bucket as origin
################################
resource "aws_cloudfront_origin_access_control" "beta_alias" {
  count                             = var.beta_alias.create ? 1 : 0
  provider                          = aws.use1
  name                              = "${var.account_shortname}-${local.s3_cf_origin}-beta"
  description                       = "${local.s3_cf_origin} beta alias CF Access Control"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "beta_alias" {
  count      = var.beta_alias.create ? 1 : 0
  provider   = aws.use1
  depends_on = [aws_cloudfront_distribution.marketplace]

  origin {
    domain_name              = aws_s3_bucket.marketplace[0].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.beta_alias[0].id
    origin_id                = "${var.account_shortname}-${local.s3_cf_origin}-beta"
  }

  http_version        = "http2and3"
  web_acl_id          = data.aws_wafv2_web_acl.bedrock_waf_cloudfront.arn
  retain_on_delete    = false
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.beta_alias.hostname} alias of ${local.hp_dns["exc"].name}"
  default_root_object = "index.html"
  aliases             = var.apex_site == "beta" ? [var.beta_alias.hostname, local.hp_dns["exc"].name] : [var.beta_alias.hostname]
  price_class         = "PriceClass_100" # Cheapest tier; this is just an alias hostname

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "${var.account_shortname}-${local.s3_cf_origin}-beta"
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 600
    max_ttl                = 1200
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.beta_alias[0].certificate_arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
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

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = var.beta_alias.hostname
      Capability = "CloudFront Distribution",
    },
  )
}

################################
# DNS — beta.hashpower.exchange A-alias in the ROOT zone (titanio-net)
################################
resource "aws_route53_record" "beta_alias" {
  count    = var.beta_alias.create ? 1 : 0
  provider = aws.titanio-net
  zone_id  = data.aws_route53_zone.hp_exchange_root[0].zone_id
  name     = var.beta_alias.hostname
  type     = "A"

  alias {
    name                   = aws_cloudfront_distribution.beta_alias[0].domain_name
    zone_id                = aws_cloudfront_distribution.beta_alias[0].hosted_zone_id
    evaluate_target_health = false
  }
}
