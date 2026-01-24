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
    expression = "rate(5 minutes)"
  }

  run_config {
    timeout_in_seconds = 60
    memory_in_mb       = 1024
    active_tracing     = false
  }

  # Inline canary script - checks page loads successfully
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

# Create canary script archive
data "archive_file" "canary_script" {
  count       = var.monitoring.create && var.monitoring.create_synthetics_canary ? 1 : 0
  type        = "zip"
  output_path = "${path.module}/canary_script.zip"

  source {
    content  = <<-PYTHON
import time
from aws_synthetics.selenium import synthetics_webdriver as webdriver
from aws_synthetics.common import synthetics_logger as logger

URL = "${local.futures_ui_url}"

def verify_page_loads():
    """Verify the Futures UI page loads correctly."""
    logger.info(f"Starting canary check for: {URL}")
    
    # Launch browser
    browser = webdriver.Chrome()
    browser.set_viewport_size(1920, 1080)
    
    try:
        # Navigate to the page
        browser.get(URL)
        logger.info("Page navigation initiated")
        
        # Wait for SPA to hydrate (React/Vue apps need time to render)
        time.sleep(5)
        
        # Verify page title exists
        title = browser.title
        logger.info(f"Page title: {title}")
        if not title:
            raise Exception("Page has no title")
        
        # SPA-friendly content check: verify root element has children
        has_content = browser.execute_script("""
            const root = document.getElementById('root') || 
                         document.getElementById('app') || 
                         document.body;
            return root && root.children.length > 0;
        """)
        
        if not has_content:
            raise Exception("Page appears to have no rendered content")
        
        logger.info("Page content verification passed")
        
        # Take screenshot for debugging
        browser.save_screenshot("page_loaded.png")
        logger.info("Screenshot saved")
        
        logger.info("Canary completed successfully")
        return "Success"
        
    except Exception as e:
        # Take screenshot on failure for debugging
        try:
            browser.save_screenshot("failure.png")
        except:
            pass
        logger.error(f"Canary failed: {str(e)}")
        raise

def handler(event, context):
    return verify_page_loads()
PYTHON
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
  evaluation_periods  = 2
  metric_name         = "SuccessPercent"
  namespace           = "CloudWatchSynthetics"
  period              = 300
  statistic           = "Average"
  threshold           = 100
  alarm_description   = "Futures UI Synthetics Canary is failing - page may not be loading correctly"
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
