################################
# GLOBAL CloudFront and DNS 
################################

# Create CloudFront Distribution: 
resource "aws_cloudfront_distribution" "marketplace" {
  count    = var.create_marketplace_s3cf ? 1 : 0
  provider = aws.use1
  origin {
    domain_name              = aws_s3_bucket.marketplace[0].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.marketplace[0].id
    origin_id                = "${var.account_shortname}-${local.s3_cf_origin}"
  }
  http_version        = "http2and3"
  web_acl_id          = data.aws_wafv2_web_acl.bedrock_waf_cloudfront[0].arn
  retain_on_delete    = true
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin_root.name} Distribution"
  default_root_object = "index.html"
  aliases = [
    var.account_lifecycle == "prd" ? "${local.s3_cf_origin}.${data.aws_route53_zone.public_lumerin_root.name}" : "${local.s3_cf_origin}.${data.aws_route53_zone.public_lumerin.name}",
    var.account_lifecycle == "prd" ? "${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin_root.name}" : "${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin.name}"
  ]
  price_class = "PriceClass_200" #200=all except SouthAmerica, Australia/NZ, 100=NA/EMEA only All=All
  logging_config {
    include_cookies = false
    bucket          = "${var.account_shortname}-devops.s3.amazonaws.com"
    prefix          = var.account_lifecycle == "prd" ? "${local.s3_cf_origin}.${data.aws_route53_zone.public_lumerin_root.name}" : "${local.s3_cf_origin}.${data.aws_route53_zone.public_lumerin.name}}."
  }
  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "${var.account_shortname}-${local.s3_cf_origin}"
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
  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.lumerin_marketplace_website[0].arn
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
}

resource "aws_cloudfront_origin_access_control" "marketplace" {
  count                             = var.create_marketplace_s3cf ? 1 : 0
  provider                          = aws.use1
  name                              = "${var.account_shortname}-${local.s3_cf_origin}"
  description                       = "${local.s3_cf_origin} CF Access Control"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}


########## DNS Record  
resource "aws_route53_record" "marketplace" {
  count    = var.create_marketplace_s3cf ? 1 : 0
  provider = aws.special-dns
  zone_id  = var.account_lifecycle == "prd" ? data.aws_route53_zone.public_lumerin_root.zone_id : data.aws_route53_zone.public_lumerin.zone_id
  name     = var.account_lifecycle == "prd" ? "${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin_root.name}" : "${local.s3_cf_website}.${data.aws_route53_zone.public_lumerin.name}"
  type     = "A"
  alias {
    name                   = aws_cloudfront_distribution.marketplace[0].domain_name
    zone_id                = aws_cloudfront_distribution.marketplace[0].hosted_zone_id
    evaluate_target_health = true
  }
}

########## DNS Record Source Alias
resource "aws_route53_record" "marketplace_origin_alias" {
  count    = var.create_marketplace_s3cf ? 1 : 0
  provider = aws.special-dns
  zone_id  = var.account_lifecycle == "prd" ? data.aws_route53_zone.public_lumerin_root.zone_id : data.aws_route53_zone.public_lumerin.zone_id
  name     = var.account_lifecycle == "prd" ? "${local.s3_cf_origin}.${data.aws_route53_zone.public_lumerin_root.name}" : "${local.s3_cf_origin}.${data.aws_route53_zone.public_lumerin.name}"
  type     = "A"
  alias {
    name                   = aws_cloudfront_distribution.marketplace[0].domain_name
    zone_id                = aws_cloudfront_distribution.marketplace[0].hosted_zone_id
    evaluate_target_health = true
  }
}