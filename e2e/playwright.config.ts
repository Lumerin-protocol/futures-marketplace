import { defineConfig, devices } from "@playwright/test";
import { loadE2EEnv, UI_ROOT } from "./src/env";

const env = loadE2EEnv();
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  outputDir: "./reports/test-results",
  // One funded wallet means one nonce sequence and one shared account state.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Each on-chain step waits for a receipt and then for the subgraph to index it.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  globalSetup: "./src/global-setup.ts",
  reporter: [
    ["list"],
    ["html", { outputFolder: "reports/playwright-report", open: "never" }],
    ["json", { outputFile: "reports/results.json" }],
    ["junit", { outputFile: "reports/junit.xml" }],
    ["./src/reporters/summary-reporter.ts"],
  ],
  use: {
    baseURL: env.baseURL,
    locale: "en-US",
    // DateTimeCell renders in the browser's zone; UTC keeps parsed timestamps exact.
    timezoneId: "UTC",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Wide enough for the full desktop header (the brand name hides below 1140px).
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: env.startWebServer
    ? {
        command: `pnpm exec vite --port ${env.uiPort} --strictPort`,
        cwd: UI_ROOT,
        url: env.baseURL,
        env: { APP_ENV: env.target },
        reuseExistingServer: !isCI,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
      }
    : undefined,
});
