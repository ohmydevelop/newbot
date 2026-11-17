import { defineConfig } from "@playwright/test";
import base from "./playwright.event-ingress.config";
export default defineConfig({
  ...base,
  outputDir: ".data/trigger-groups/browser",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: ".issue/2026-11-18/evidence-history-reset/browser.json" },
    ],
  ],
});
