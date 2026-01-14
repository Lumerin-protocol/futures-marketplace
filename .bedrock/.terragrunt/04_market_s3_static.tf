# Assumes: 
# Bedrock Foundation-core and Foundation-extra
# Basic instructions: https://mosano.eu/post/how-to-host-a-gatsby-website-on-aws-s3 

# TO DO: 
# Add healthchecks for DNS 
# Add configurations to Shield 
# Add monitoring and Alerting dashboards 


############ S3 Bucket  for Marketplace Website 
resource "aws_s3_bucket" "marketplace" {
  count    = var.create_marketplace_s3cf ? 1 : 0
  provider = aws.use1
  bucket   = var.account_lifecycle == "prd" ? "${local.s3_cf_origin}.${data.aws_route53_zone.public_lumerin_root.name}" : "${local.s3_cf_origin}.${data.aws_route53_zone.public_lumerin.name}"
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
  count    = var.create_marketplace_s3cf ? 1 : 0
  provider = aws.use1
  bucket   = aws_s3_bucket.marketplace[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "marketplace" {
  count    = var.create_marketplace_s3cf ? 1 : 0
  provider = aws.use1
  bucket   = aws_s3_bucket.marketplace[0].id
  policy   = data.aws_iam_policy_document.s3_marketplace[0].json
}

data "aws_iam_policy_document" "s3_marketplace" {
  count    = var.create_marketplace_s3cf ? 1 : 0
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
      values   = [aws_cloudfront_distribution.marketplace[0].arn]
    }
  }
}

resource "aws_s3_bucket_public_access_block" "marketplace" {
  provider                = aws.use1
  count                   = var.create_marketplace_s3cf ? 1 : 0
  bucket                  = aws_s3_bucket.marketplace[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "marketplace" {
  count    = var.create_marketplace_s3cf ? 1 : 0
  provider = aws.use1
  bucket   = aws_s3_bucket.marketplace[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}