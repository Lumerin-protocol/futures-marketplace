##########################
# Route53 writes for resources that use provider = aws.special-dns
# (e.g. aws_route53_record.marketplace in .terragrunt/04_futures_ui.tf)
#
# Workload is titanio-lmn. The hashpower.exchange zone (including the apex)
# is owned by titanio-net, not this account and not titanio-prd.
##########################
provider "aws" {
  alias   = "special-dns"
  region  = "us-east-1"
  profile = "titanio-net"
  ignore_tags {
    key_prefixes = ["kubernetes.io/"]
  }
}

