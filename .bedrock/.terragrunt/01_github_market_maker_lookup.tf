################################################################################
# GITHUB REPOSITORY TAGS LOOKUP - MARKET MAKER
# Queries GitHub repository tags to get latest tag for current environment
# Uses public API (no authentication required)
#
# NOTE: Git tags are created by the GitHub Actions workflow after successful
# deployments. Until tags exist, this will fall back to the tfvars value.
# The GHCR container versions exist but require authentication to query.
################################################################################

################################
# Data source to lookup GitHub repository tags for this environment only
################################
data "http" "github_market_maker_tags" {
  count = var.market_maker.create ? 1 : 0
  url   = "https://api.github.com/repos/lumerin-protocol/futures-marketplace/tags"

  request_headers = {
    Accept = "application/vnd.github+json"
  }

  lifecycle {
    postcondition {
      condition     = self.status_code == 200
      error_message = "Failed to fetch GitHub repository tags (status: ${self.status_code}). Check repository name and network connectivity."
    }
  }
}

################################
# Local values for tag extraction
################################
locals {
  # Parse repository tags from GitHub API response
  # API returns array of objects with "name" field for each tag
  github_market_maker_tags_raw = var.market_maker.create ? try(jsondecode(data.http.github_market_maker_tags[0].response_body), []) : []

  # Regex pattern for market-maker tags in this environment
  # Tags follow format: market-maker-vX.Y.Z or market-maker-vX.Y.Z-env
  # dev: tags ending in -dev (e.g., market-maker-v0.1.0-dev)
  # stg: tags ending in -stg (e.g., market-maker-v0.1.0-stg)
  # lmn/prd: tags that are just market-maker-vX.Y.Z (no suffix)
  market_maker_tag_pattern = var.account_lifecycle == "dev" ? "^market-maker-v.*-dev$" : var.account_lifecycle == "stg" ? "^market-maker-v.*-stg$" : "^market-maker-v[0-9]"

  # Extract tags matching this environment only
  # GitHub returns tags in reverse chronological order (newest first)
  github_market_maker_tags_filtered = [
    for tag in local.github_market_maker_tags_raw :
    # Extract just the version part (e.g., "v0.1.0-dev" from "market-maker-v0.1.0-dev")
    replace(tag.name, "market-maker-", "")
    if can(regex(local.market_maker_tag_pattern, tag.name)) &&
    # For lmn, also exclude dev/stg tags
    (var.account_lifecycle != "lmn" || !can(regex("-(dev|stg)$", tag.name)))
  ]

  # Get the latest tag for this environment (first in list is most recent)
  # Returns null if no tags found
  github_market_maker_latest_tag = length(local.github_market_maker_tags_filtered) > 0 ? local.github_market_maker_tags_filtered[0] : null

  # Determine which image tag to use:
  # Priority order:
  # 1. If mm_imagetag is a specific version (not "auto"), use that (allows pinning)
  # 2. If mm_imagetag is "auto" and GitHub tags exist, use the latest tag
  # 3. If mm_imagetag is "auto" but no tags exist, fall back to environment-latest pattern
  #
  # Fallback pattern by environment:
  # - dev: "dev-latest"
  # - stg: "stg-latest"  
  # - lmn/prd: "main-latest"
  market_maker_fallback_tag = var.account_lifecycle == "dev" ? "dev-latest" : (
    var.account_lifecycle == "stg" ? "stg-latest" : "main-latest"
  )

  market_maker_image_tag = var.market_maker.create ? (
    # If a specific version is pinned in tfvars, use it
    var.market_maker["mm_imagetag"] != "auto" && var.market_maker["mm_imagetag"] != "" ?
    var.market_maker["mm_imagetag"] :
    # Otherwise try auto-lookup, fall back to environment-latest if no tags
    coalesce(local.github_market_maker_latest_tag, local.market_maker_fallback_tag)
  ) : ""
}

################################
# Outputs
################################
output "github_market_maker_latest_tag" {
  value       = var.market_maker.create ? local.github_market_maker_latest_tag : null
  description = "Latest GitHub container tag for market maker in this environment"
}

output "github_market_maker_tags_available" {
  value       = var.market_maker.create ? local.github_market_maker_tags_filtered : null
  description = "All available GitHub container tags for market maker in this environment"
}

output "market_maker_image_tag" {
  value       = var.market_maker.create ? local.market_maker_image_tag : null
  description = "Resolved image tag for market maker (auto-lookup or pinned)"
}

