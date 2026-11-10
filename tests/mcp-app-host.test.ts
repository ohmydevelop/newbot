import { test } from "node:test";
import { z } from "zod";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  App,
  McpUiHostCapabilitiesSchema,
} from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  InMemoryTransport,
  METHOD_NOT_FOUND,
  ProtocolError,
} from "@modelcontextprotocol/client";
import { restrictAppHost } from "../web/components/mcp-app-host.js";
import {
  APP_HOST_RESTRICTIONS,
  appHostCapabilities,
  appHostPolicy,
} from "../shared/mcp-app-host.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";

async function protocol(
  fn: (f: { app: App; bridge: AppBridge; notices: string[] }) => Promise<void>,
  tools = true,
) {
  const notices: string[] = [],
    bridge = new AppBridge(
      null,
      { name: "newbot-host-test", version: "1" },
      appHostCapabilities(tools),
      {
        hostContext: {
          displayMode: "inline",
          availableDisplayModes: ["inline"],
        },
      },
    ),
    app = new App(
      { name: "standard-sdk-view", version: "1" },
      {},
      { autoResize: false },
    ),
    [host, view] = InMemoryTransport.createLinkedPair();
  restrictAppHost(
    bridge,
    () => true,
    (text) => notices.push(text),
  );
  try {
    await bridge.connect(host);
    await app.connect(view);
    await fn({ app, bridge, notices });
  } finally {
    await app.close();
    await bridge.close();
  }
}

test("the real SDK handshake advertises only scoped tool calls, inline presentation and an empty sandbox permission set", async () => {
  await protocol(async ({ app }) => {
    const caps = app.getHostCapabilities();
    McpUiHostCapabilitiesSchema.parse(caps);
    assert.deepEqual(caps, appHostCapabilities(true));
    assert.deepEqual(Object.keys(caps!).sort(), ["sandbox", "serverTools"]);
    assert.deepEqual(app.getHostContext()?.availableDisplayModes, ["inline"]);
  });
  await protocol(async ({ app }) => {
    assert.equal(app.getHostCapabilities()?.serverTools, undefined);
    assert.deepEqual(app.getHostCapabilities()?.sandbox?.permissions, {});
  }, false);
});

test("message, link and download requests return explicit standard error results without reflecting application data", async () => {
  await protocol(async ({ app, notices }) => {
    const requests = [
      {
        method: "ui/message",
        params: {
          role: "user",
          content: [{ type: "text", text: "SYNTHETIC_PRIVATE_MESSAGE" }],
        },
      },
      {
        method: "ui/open-link",
        params: { url: "https://forbidden.invalid/SYNTHETIC_PRIVATE_LINK" },
      },
      {
        method: "ui/download-file",
        params: {
          contents: [
            {
              type: "resource",
              resource: {
                uri: "data:,fixture",
                text: "SYNTHETIC_PRIVATE_FILE",
                mimeType: "text/plain",
              },
            },
          ],
        },
      },
    ];
    for (const request of requests) {
      const result = await app.request(request, z.object({}).passthrough(), {
        timeout: 1000,
      });
      assert.equal(result.isError, true);
      assert.equal(result.reason, "unsupported");
      assert.equal(typeof result.message, "string");
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|forbidden/);
    }
    assert.equal(notices.length, 3);
    assert.doesNotMatch(JSON.stringify(notices), /SYNTHETIC|forbidden/);
    await app.request({ method: "ping" }, { timeout: 1000 });
  });
});

test("unavailable context, resources, prompts, sampling and unknown methods fail with bounded JSON-RPC errors and leave the connection usable", async () => {
  await protocol(async ({ app, notices }) => {
    const methods = [
      "ui/update-model-context",
      "resources/read",
      "resources/list",
      "resources/templates/list",
      "prompts/list",
      "tools/list",
      "sampling/createMessage",
      "untrusted/SYNTHETIC_PRIVATE_METHOD",
    ];
    for (const method of methods) {
      await assert.rejects(
        app.request(
          {
            method,
            params: {
              uri: "secret://SYNTHETIC_PRIVATE",
              content: [{ type: "text", text: "SYNTHETIC_PRIVATE" }],
              messages: [],
              maxTokens: 1,
            },
          },
          z.object({}).passthrough(),
          { timeout: 1000 },
        ),
        (e: any) =>
          e instanceof ProtocolError &&
          e.code === METHOD_NOT_FOUND &&
          (e.data as { reason?: unknown } | undefined)?.reason ===
            "unsupported" &&
          !/SYNTHETIC|secret:/.test(
            JSON.stringify({ message: e.message, data: e.data }),
          ),
      );
      await app.request({ method: "ping" }, { timeout: 1000 });
    }
    assert.equal(notices.length, methods.length);
    assert.equal(notices.at(-1), APP_HOST_RESTRICTIONS.unknown);
  });
});

test("fullscreen and picture-in-picture requests return the actual inline mode instead of false success", async () => {
  await protocol(async ({ app, notices }) => {
    for (const mode of ["fullscreen", "pip"] as const)
      assert.deepEqual(await app.requestDisplayMode({ mode }), {
        mode: "inline",
      });
    assert.equal(notices.length, 2);
    assert.deepEqual(await app.requestDisplayMode({ mode: "inline" }), {
      mode: "inline",
    });
    assert.equal(notices.length, 2);
  });
});

test("logging and unknown notifications are discarded, and capability handlers do not grant tool access", async () => {
  await protocol(async ({ app, notices }) => {
    await app.notification({
      method: "notifications/message",
      params: { level: "error", data: "SYNTHETIC_PRIVATE_LOG" },
    });
    await app.notification({
      method: "untrusted/SYNTHETIC_PRIVATE_NOTIFICATION",
    });
    await assert.rejects(
      app.request(
        { method: "tools/call", params: { name: "danger", arguments: {} } },
        { timeout: 1000 },
      ),
    );
    await app.request({ method: "ping" }, { timeout: 1000 });
    assert.deepEqual(notices, [APP_HOST_RESTRICTIONS.unknown]);
  });
});

test("runtime diagnostics report disabled embedding and never advertise extra privileges when no independent App origin is configured", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-host-policy-")),
    { app } = await createServer({
    providerRuntime: null,
      directory,
      cwd: join(directory, "work"),
      codex: new FakeCodex(),
      password: "host-policy-test-password",
      origins: ["http://127.0.0.1:3100", "http://localhost:3100"],
    });
  try {
    const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin: "http://127.0.0.1:3100" },
        payload: { password: "host-policy-test-password" },
      }),
      cookie = String(login.headers["set-cookie"]).split(";")[0],
      response = await app.inject({
        url: "/api/runtime/capabilities",
        headers: { cookie },
      }),
      caps = response.json().capabilities;
    assert.equal(caps.mcpApps, false);
    assert.deepEqual(caps.mcpAppHost, {
      ...appHostPolicy(false),
      available: false,
    });
    assert.equal(caps.mcpAppHost.protocolCapabilities.serverTools, undefined);
    assert.doesNotMatch(response.body, /super-secret|HIDDEN_KEY/);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
