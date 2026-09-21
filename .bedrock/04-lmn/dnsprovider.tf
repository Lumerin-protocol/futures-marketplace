##########################
# Route53 writes for resources that use provider = aws.special-dns
# (e.g. aws_route53_record.marketplace in .terragrunt/04_futures_ui.tf)
#
# 04-lmn uses account_lifecycle = "prd" (see terraform.tfvars) but workload is still
# titanio-lmn (provider_profile). Root DNS ownership differs by brand:
#   - lumerin.io root zones → historically titanio-prd
#   - hashpower.exchange root → titanio-net (see aws.titanio-net on hp_root in 00_data_global.tf)
#
# If Terraform cannot create/update apex records for hashpower.exchange with this profile,
# switch profile to titanio-net or add records manually in the net account—no code change
# required in .terragrunt for that path beyond provider credentials.
##########################
provider "aws" {
  alias   = "special-dns"
  region  = "us-east-1"
  profile = "titanio-prd"
  ignore_tags {
    key_prefixes = ["kubernetes.io/"]
  }
}

