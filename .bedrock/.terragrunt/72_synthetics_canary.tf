################################################################################
# CLOUDWATCH SYNTHETICS CANARY - Production UI Health Check
# Only created in LMN/Production environment
################################################################################

resource "aws_synthetics_canary" "futures_ui" {
  count                = var.monitoring.create && var.monitoring.create_synthetics_canary ? 1 : 0
  name                 = "futures-ui-${local.env_suffix}"
  artifact_s3_location = "s3://${aws_s3_bucket.synthetics_artifacts[0].id}/canary/"
  execution_role_arn   = aws_iam_role.synthetics_canary[0].arn
  handler              = "canary.handler"
  runtime_version      = "syn-python-selenium-8.0"
  start_canary         = true

  schedule {
    # AWS normalizes "rate(60 minutes)" to "rate(1 hour)" - use hour format to avoid perpetual drift
    expression = var.monitoring_schedule.synthetics_canary_rate_minutes == 60 ? "rate(1 hour)" : "rate(${var.monitoring_schedule.synthetics_canary_rate_minutes} minutes)"
  }

  run_config {
    timeout_in_seconds = 60
    memory_in_mb       = 1024
    active_tracing     = false
  }

  # Path includes the script hash so a URL or assertion change replaces the canary.
  zip_file = data.archive_file.canary_script[0].output_path

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures UI Health Check",
      Capability = "Monitoring",
    },
  )

  depends_on = [
    aws_iam_role_policy.synthetics_canary,
    aws_s3_bucket.synthetics_artifacts
  ]
}

locals {
  # Rendered before the archive so the zip path changes when the URL or the
  # assertions change. A fixed path never shows up in a plan.
  exchange_canary_script = <<-PYTHON
import time
from aws_synthetics.selenium import synthetics_webdriver as webdriver
from aws_synthetics.common import synthetics_logger as logger

URL = "${local.exchange_probe_url}"

def verify_page_loads():
    """The exchange app is up. A holding page must not pass."""
    logger.info(f"Starting canary check for: {URL}")

    browser = webdriver.Chrome()
    browser.set_viewport_size(1920, 1080)

    try:
        browser.get(URL)
        time.sleep(5)

        title = browser.title
        logger.info(f"Page title: {title}")
        if title != "HPDX":
            raise Exception(f"Expected the HPDX app, got title {title!r}")

        marker = browser.execute_script("""
            const text = document.body ? document.body.innerText : "";
            return {
              comingSoon: text.includes("COMING SOON"),
              hasRoot: !!document.getElementById("root")
            };
        """)
        if marker.get("comingSoon"):
            raise Exception("Holding page is being served")
        if not marker.get("hasRoot"):
            raise Exception("App root is missing")

        browser.save_screenshot("page_loaded.png")
        logger.info("Canary completed successfully")
        return "Success"
    except Exception as e:
        try:
            browser.save_screenshot("failure.png")
        except Exception:
            pass
        logger.error(f"Canary failed: {str(e)}")
        raise

def handler(event, context):
    return verify_page_loads()
PYTHON
}

data "archive_file" "canary_script" {
  count       = var.monitoring.create && var.monitoring.create_synthetics_canary ? 1 : 0
  type        = "zip"
  output_path = "${path.module}/canary_${md5(local.exchange_canary_script)}.zip"

  source {
    content  = local.exchange_canary_script
    filename = "python/canary.py"
  }
}

################################################################################
# CLOUDWATCH ALARM FOR CANARY FAILURES
################################################################################

resource "aws_cloudwatch_metric_alarm" "canary_failed" {
  count               = var.monitoring.create && var.monitoring.create_alarms && var.monitoring.create_synthetics_canary ? 1 : 0
  alarm_name          = "futures-ui-canary-failed-${local.env_suffix}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = local.canary_alarm_evaluation_periods # unhealthy_alarm_period / canary_rate
  metric_name         = "SuccessPercent"
  namespace           = "CloudWatchSynthetics"
  period              = var.monitoring_schedule.synthetics_canary_rate_minutes * 60 # Match canary rate
  statistic           = "Average"
  threshold           = 100
  alarm_description   = "Futures UI Canary failing for ${var.monitoring_schedule.unhealthy_alarm_period_minutes} minutes"
  treat_missing_data  = "breaching"

  dimensions = {
    CanaryName = aws_synthetics_canary.futures_ui[0].name
  }

  alarm_actions = local.component_alarm_actions
  ok_actions    = local.component_alarm_actions

  tags = merge(
    var.default_tags,
    var.foundation_tags,
    {
      Name       = "Futures UI Canary Failed Alarm",
      Capability = "Monitoring",
    },
  )
}
