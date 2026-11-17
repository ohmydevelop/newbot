import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: ["**/event-bridge.spec.ts"],
  fullyParallel: false,
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [
    ["list"],
    ["json", { outputFile: ".data/ui-verification/results.json" }],
    ["html", { outputFolder: ".data/ui-verification/report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3169",
    browserName: "chromium",
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    video: { mode: "on", size: { width: 1280, height: 844 } },
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "ISSUE_TEST_PORT=3169 ISSUE_RICH_UI=1 ISSUE_MEMORY_PROVIDERS=1 ISSUE05_UI=1 ISSUE_CATALOG_RACES=1 node --import tsx tests/issue-preview-server.ts",
    url: "http://127.0.0.1:3169/api/ready",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
