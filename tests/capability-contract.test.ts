import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { testSudo } from "./sudo-fixture.js";
import { CODEX_VERSION } from "../generated/version.js";
const origin = "https://main.example.invalid";
async function setup(
  appOrigin: string | undefined,
  transport: string,
  sudo = false,
) {
  const keys = [
      "APP_ORIGIN",
      "AGENT_TRANSPORT",
      "SUDO_IDENTITY_CHECK",
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    ],
    previous = new Map(keys.map((k) => [k, process.env[k]]));
  for (const key of keys) delete process.env[key];
  if (appOrigin) process.env.APP_ORIGIN = appOrigin;
  process.env.AGENT_TRANSPORT = transport;
  const directory = mkdtempSync(join(tmpdir(), "newbot-capabilities-")),
    codex = new FakeCodex();
  try {
    const ctx = await createServer({
      providerRuntime: null,
      directory,
      cwd: join(directory, "workspace"),
      codex,
      password: "capability-contract-login",
      origins: [origin],
      ...(sudo ? { sudoIdentity: testSudo() } : {}),
    });
    await ctx.app.ready();
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "capability-contract-login" },
    });
    assert.equal(login.statusCode, 200);
    const headers = {
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
      origin,
    };
    return {
      ctx,
      codex,
      headers,
      close: async () => {
        await ctx.app.close();
        rmSync(directory, { recursive: true, force: true });
        for (const [k, v] of previous)
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    for (const [k, v] of previous)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    throw error;
  }
}
test("a named main origin without an isolated app origin never advertises executable HTML or Apps", async () => {
  const f = await setup(undefined, "sse");
  try {
    const r = await f.ctx.app.inject({
      url: "/api/runtime/capabilities",
      headers: f.headers,
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["cache-control"], "no-store");
    const c = r.json();
    assert.equal(c.webTransport, "sse");
    assert.equal(c.capabilities.mcpApps, false);
    assert.equal(c.capabilities.mcpAppHost.available, false);
    assert.equal(c.capabilities.artifacts.htmlExecution, false);
    assert.ok(!c.capabilities.artifacts.previewKinds.includes("html"));
    assert.equal(
      c.capabilities.mcpAppHost.protocolCapabilities.serverTools,
      undefined,
    );
    assert.equal(c.capabilities.traces, false);
    assert.equal(c.capabilities.trustedInput.sudo, false);
    assert.equal(
      (await f.ctx.app.inject({ url: "/api/runtime/capabilities" })).statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});
test("enabled Apps and fixed sudo expose only the implemented host and trusted-input scopes", async () => {
  const f = await setup("https://apps.example.invalid", "poll", true);
  try {
    const r = await f.ctx.app.inject({
      url: "/api/runtime/capabilities",
      headers: f.headers,
    });
    const c = r.json(),
      caps = c.capabilities;
    assert.equal(c.webTransport, "poll");
    assert.equal(caps.mcpApps, true);
    assert.equal(caps.mcpAppHost.available, true);
    assert.equal(caps.artifacts.htmlExecution, true);
    assert.ok(caps.artifacts.previewKinds.includes("html"));
    assert.deepEqual(caps.mcpAppHost.displayModes, ["inline"]);
    for (const key of [
      "network",
      "openLinks",
      "downloads",
      "messages",
      "modelContext",
      "sampling",
      "serverResources",
      "toolDiscovery",
      "prompts",
      "logging",
    ])
      assert.equal(caps.mcpAppHost[key], false, key);
    assert.equal(caps.trustedInput.sudoIdentity.operation, "sudo.identity");
    assert.equal(caps.trustedInput.sudoIdentity.arbitraryCommands, false);
    assert.equal(caps.trustedInput.agentRequests, false);
    assert.equal(caps.trustedInput.storage.stdio, false);
    assert.equal(caps.elicitation.sensitiveInput, false);
    assert.equal(caps.elicitation.urlMode, false);
    assert.equal(caps.a2ui.privateInput, false);
    assert.equal(caps.a2ui.historyRestoration, true);
    assert.equal(caps.a2ui.drafts.restartReadOnly, true);
    assert.equal(caps.a2a, false);
    assert.equal(caps.acp, false);
    assert.equal(
      f.codex.calls.filter((v) => v.method === "turn/start").length,
      0,
    );
  } finally {
    await f.close();
  }
});
test("capability discovery reports the pinned runtime and never claims provider compatibility or a negotiated MCP version", async () => {
  const f = await setup(undefined, "sse");
  try {
    const r = await f.ctx.app.inject({
        url: "/api/runtime/capabilities",
        headers: f.headers,
      }),
      c = r.json();
    assert.equal(c.agent, "codex");
    assert.equal(c.version, CODEX_VERSION);
    assert.equal(c.eventProtocol.name, "AG-UI");
    assert.equal(c.mcp.negotiation, "codex-managed");
    assert.equal(c.mcp.protocolVersion, null);
    assert.equal(c.capabilities.providerManagement.responsesDiagnostic, true);
    assert.equal(
      c.capabilities.providerManagement.fullCompatibility,
      undefined,
    );
    assert.equal(c.capabilities.skillSelection.maxPerMessage, 8);
    assert.equal(c.capabilities.runRecovery.abandonUnseen, true);
    assert.ok(!r.body.includes("super-secret-DO-NOT-LEAK"));
    assert.ok(!r.body.includes("HIDDEN_KEY"));
    assert.ok(!r.body.includes("capability-contract-login"));
  } finally {
    await f.close();
  }
});
