import { appendFileSync } from "node:fs";
import type { FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";
import { loadE2EEnv } from "../env";

/**
 * One line at the very end of the run, then one per failure and one per skip
 * reason. A reporter rather than globalTeardown: teardown runs before the
 * json/junit reporters write their files.
 */
export default class SummaryReporter implements Reporter {
  private suite?: Suite;

  onBegin(_config: unknown, suite: Suite) {
    this.suite = suite;
  }

  onEnd(result: FullResult) {
    if (process.argv.includes("--list")) return;
    const tests = this.suite?.allTests() ?? [];
    const count = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    const failed: TestCase[] = [];
    const skipReasons = new Map<string, number>();
    for (const test of tests) {
      const outcome = test.outcome();
      if (outcome === "expected") count.passed++;
      else if (outcome === "flaky") count.flaky++;
      else if (outcome === "skipped") {
        count.skipped++;
        const reason = skipReason(test);
        skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
      } else {
        count.failed++;
        failed.push(test);
      }
    }

    const env = loadE2EEnv();
    const lines = [
      `[hpdx-e2e] ${result.status.toUpperCase()} | target=${env.target} ${env.baseURL} | ` +
        `${count.passed} passed, ${count.failed} failed, ${count.flaky} flaky, ${count.skipped} skipped ` +
        `of ${tests.length} in ${formatDuration(result.duration)} | ` +
        "reports: e2e/reports/{playwright-report/index.html,results.json,junit.xml}",
      ...failed.map((test) => `  ✘ ${test.titlePath().filter(Boolean).slice(1).join(" › ")}`),
      ...[...skipReasons].map(([reason, n]) => `  ↷ ${n} skipped: ${reason}`),
    ];
    console.log(`\n${lines.join("\n")}`);
    const stepSummary = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummary) appendFileSync(stepSummary, `### HPDX E2E\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  }

  printsToStdio() {
    return true;
  }
}

function skipReason(test: TestCase): string {
  const annotations = [...test.annotations, ...(test.results.at(-1)?.annotations ?? [])];
  return annotations.find((annotation) => annotation.type === "skip")?.description ?? "not run";
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
