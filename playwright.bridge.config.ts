import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "event-bridge.spec.ts",
  testIgnore: [],
  outputDir: ".data/bridge-ui",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: ".issue/2026-11-17/evidence-event-bridge/browser.json" },
    ],
  ],
  use: { ...base.use, baseURL: "http://127.0.0.1:3179" },
  webServer: {
    command:
      "ISSUE_TEST_PORT=3179 ISSUE_RICH_UI=1 ISSUE_MEMORY_PROVIDERS=1 ISSUE05_UI=1 ISSUE_EVENT_BRIDGE=1 node --import tsx tests/issue-preview-server.ts",
    url: "http://127.0.0.1:3179/api/ready",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
