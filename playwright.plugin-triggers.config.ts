import { defineConfig } from "@playwright/test";
import base from "./playwright.bridge.config";
export default defineConfig({
  ...base,
  testMatch: ["event-bridge.spec.ts", "automation-events.spec.ts"],
  outputDir: ".data/plugin-only-triggers/browser",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          ".issue/2026-11-17/evidence-plugin-only-triggers/browser.json",
      },
    ],
  ],
});
