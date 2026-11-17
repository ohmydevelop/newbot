import { defineConfig } from "@playwright/test";
import base from "./playwright.bridge.config";
export default defineConfig({
  ...base,
  testMatch: [
    "event-ingress.spec.ts",
    "event-bridge.spec.ts",
    "automation-events.spec.ts",
  ],
  outputDir: ".data/direct-event-ingress/browser",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          ".issue/2026-11-17/evidence-direct-event-ingress/browser.json",
      },
    ],
  ],
});
