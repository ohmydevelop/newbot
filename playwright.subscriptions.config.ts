import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "event-subscriptions.spec.ts",
  outputDir: ".data/subscription-ui",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          ".issue/2026-11-17/evidence-subscriptions-integration/browser.json",
      },
    ],
  ],
  use: { ...base.use, baseURL: "http://127.0.0.1:3178" },
  webServer: {
    command:
      "ISSUE_TEST_PORT=3178 ISSUE_RICH_UI=1 ISSUE_MEMORY_PROVIDERS=1 ISSUE05_UI=1 ISSUE_EVENT_SUBSCRIPTIONS=1 node --import tsx tests/issue-preview-server.ts",
    url: "http://127.0.0.1:3178/api/ready",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
