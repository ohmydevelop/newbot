import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/mobile",
  outputDir: ".data/mobile-verification/artifacts",
  timeout: 90000,
  webServer: {
    ...(base.webServer as any),
    command: "ISSUE_PLUGIN_SKILL=1 " + (base.webServer as any).command,
  },
  reporter: [
    ["list"],
    ["json", { outputFile: ".data/mobile-verification/results.json" }],
  ],
  use: {
    ...base.use,
    actionTimeout: 10000,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    video: { mode: "on", size: { width: 390, height: 844 } },
  },
});
