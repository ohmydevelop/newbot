import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presentationInstructions } from "../server/presentation.js";
import { a2uiRepairHint } from "../shared/a2ui-policy.js";
import { appRegistry } from "../server/mcp-apps.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";

async function waitFor<T>(probe: () => T | undefined, timeout = 2000) {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() - started > timeout) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("rich threads get a three-step priority and the app-capable tool list", () => {
  const text = presentationInstructions(true, ["test-server/metrics"]);
  assert.match(text, /1\. MCP app tools/);
  assert.match(text, /2\. Rich surfaces/);
  assert.match(text, /3\. Markdown/);
  assert.match(text, /test-server\/metrics/);
  assert.match(text, /Chart/);
  assert.match(text, /retry once/);
  assert.match(text, /newbot:ui\/v2/);
  assert.doesNotMatch(text, /For normal answers use Markdown instead/);
});

test("app-capable tools are only named when they are real, and v1 threads are not offered v2 surfaces", () => {
  const cached = presentationInstructions(true);
  assert.match(cached, /If a matching MCP tool renders a live app/);
  assert.doesNotMatch(cached, /test-server/);
  const legacy = presentationInstructions(false, ["test-server/metrics"]);
  assert.match(legacy, /newbot_ui is not registered/);
  assert.doesNotMatch(legacy, /newbot:ui\/v2/);
  assert.doesNotMatch(legacy, /waitForAction/);
  // App-capable MCP tools stay real on legacy threads; only v2 surfaces are withheld.
  assert.match(legacy, /test-server\/metrics/);
  assert.doesNotMatch(legacy, /rebuilding its interface with newbot_ui/);
});

test("the cached catalog projects only tools that declare a UI resource", async () => {
  const apps = appRegistry(new FakeCodex());
  assert.deepEqual(apps.appTools("unknown-thread"), []);
  assert.equal(apps.catalogFresh("unknown-thread", 60_000), false);
  await apps.refresh("thread-1");
  assert.deepEqual(apps.appTools("thread-1"), [
    { server: "test-server", tool: "metrics" },
    { server: "test-server", tool: "danger" },
  ]);
  assert.deepEqual(apps.appTools("thread-1", 1), [
    { server: "test-server", tool: "metrics" },
  ]);
  assert.equal(apps.catalogFresh("thread-1", 60_000), true);
  assert.equal(apps.catalogFresh("thread-1", -1), false);
});

test("repair hints are distinct, actionable and never invite a permission bypass", () => {
  const codes = [
    "INVALID_JSON",
    "RESOURCE_LIMIT",
    "INVALID_MESSAGE",
    "invalid_ui_arguments",
    "ui_storage_unavailable",
    "ui_request_rejected",
  ];
  const hints = codes.map((code) => a2uiRepairHint(code));
  assert.equal(new Set(hints).size, codes.length);
  for (const hint of hints) {
    assert.match(hint, /retry once|check storage/i);
    assert.doesNotMatch(hint, /bypass|skip approval|ignore limit/i);
  }
  assert.match(a2uiRepairHint("INVALID_MESSAGE"), /createSurface/);
  assert.match(a2uiRepairHint("RESOURCE_LIMIT"), /64/);
  assert.match(a2uiRepairHint("something-else"), /retry once/);
});

test("a new thread warms the catalog and resumes with the app tools named", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-rich-surface-")),
    codex = new FakeCodex();
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "work"),
    codex,
    password: "rich-surface-password",
    origins: ["http://127.0.0.1:3124"],
  });
  try {
    const thread: any = await ctx.service.handle("thread/start", {
      mode: "work",
      model: "fixture-model",
      provider: "fixture",
    });
    const text = await waitFor(() => {
      const instructions =
        codex.executionContext!(thread.id).developerInstructions || "";
      return instructions.includes("test-server/metrics")
        ? instructions
        : undefined;
    });
    assert.match(text, /2\. Rich surfaces/);
    assert.match(text, /test-server\/danger/);
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
