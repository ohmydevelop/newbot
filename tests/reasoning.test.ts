import assert from "node:assert/strict";
import { test } from "node:test";
import { effortSupport, reasoningOptions } from "../shared/reasoning.js";
test("reasoning separates missing metadata, native declarations and provider-specific unknown capabilities", () => {
  assert.equal(
    effortSupport({ supportedReasoningEfforts: [] }, "low"),
    "unknown",
  );
  const declared: any = {
    supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
    reasoningCapability: {
      status: "supported",
      source: "codex-catalog",
      provider: "openai",
      revision: "a",
    },
  };
  assert.equal(effortSupport(declared, "medium"), "supported");
  assert.equal(effortSupport(declared, "high"), "unsupported");
  const gateway = {
    ...declared,
    reasoningCapability: {
      ...declared.reasoningCapability,
      status: "unknown",
      provider: "proxy",
    },
  };
  assert.equal(effortSupport(gateway, "high"), "unknown");
  assert.equal(effortSupport(gateway, "invented-value"), "unsupported");
  assert.deepEqual(
    reasoningOptions(gateway).map((v) => v.reasoningEffort),
    ["low", "medium", "high", "xhigh", "max", "ultra"],
  );
});
