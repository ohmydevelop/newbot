import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventType } from "@ag-ui/core";
import { PublicError, publicErrorMessage } from "../server/public-error.js";
import { CredentialFailure, credentialBroker } from "../server/credentials.js";
import { ConfigurationFailure } from "../server/configuration-error.js";
import { AppFailure } from "../server/app-error.js";
import { AgentEvents } from "../server/ag-ui.js";
import { publicItem, publicTurn } from "../server/view.js";
import { appToolResult } from "../server/mcp-apps.js";
import { Codex } from "../server/codex.js";
import { CODEX_VERSION } from "../generated/version.js";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
import {
  traceErrorType,
  traceOperation,
  traceIdentifier,
  traceTurnStatus,
} from "../server/telemetry-policy.js";
const secret = "D65_SYNTHETIC_PRIVATE_" + randomUUID();
const generic = "操作失败，请检查请求或服务端配置";
test("public errors require product identity; Chinese text, names and status codes cannot grant disclosure", () => {
  const raw = Object.assign(new Error("连接失败：" + secret), {
    name: "PublicError",
    statusCode: 502,
  });
  for (const error of [
    raw,
    { message: "连接失败：" + secret },
    new Error("操作失败"),
    secret,
  ])
    assert.equal(publicErrorMessage(error), generic);
  for (const error of [
    new PublicError("请重新读取状态"),
    new CredentialFailure("私密请求已结束"),
    new ConfigurationFailure("配置已变化", 409, {
      code: "conflict",
      persistence: "unchanged",
      recovery: "read",
    }),
    new AppFailure("应用已关闭", 409, { code: "expired" }),
  ])
    assert.notEqual(publicErrorMessage(error), generic);
  for (const text of [
    "错误\n" + secret,
    "错误 https://private.invalid",
    "错误 password=" + secret,
  ])
    assert.equal(publicErrorMessage(new PublicError(text)), generic);
});
test("HTTP rejects reflected diagnostics, JSON parse bodies and untrusted custom errors without losing product guidance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-isolation-api-")),
    origin = "https://isolation.test.invalid";
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    password: "isolation-api-login",
    origins: [origin],
    codex: new ProviderCodex(),
  });
  ctx.app.get("/api/test/reflected", async () => {
    throw Object.assign(new Error("连接失败：" + secret), {
      name: secret,
      statusCode: 502,
    });
  });
  ctx.app.get("/api/test/product", async () => {
    throw new PublicError("请重新读取状态");
  });
  ctx.app.get("/api/test/status", async () => {
    throw Object.assign(new Error(secret), { statusCode: secret });
  });
  try {
    await ctx.app.ready();
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "isolation-api-login" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const reflected = await ctx.app.inject({
      url: "/api/test/reflected",
      headers,
    });
    assert.equal(reflected.statusCode, 502);
    assert.equal(reflected.json().error, generic);
    const invalidStatus = await ctx.app.inject({
      url: "/api/test/status",
      headers,
    });
    assert.equal(invalidStatus.statusCode, 400);
    assert.ok(!invalidStatus.body.includes(secret));
    assert.equal(
      (await ctx.app.inject({ url: "/api/test/product", headers })).json()
        .error,
      "请重新读取状态",
    );
    const bad = await ctx.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: { ...headers, "content-type": "application/json" },
      payload: '{"secret":"' + secret + '", invalid}',
    });
    assert.ok(!bad.body.includes(secret));
    assert.equal(bad.headers["cache-control"], "no-store");
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
for (const variant of ["native-error", "failed-result"])
  test(`MCP ${variant} is suppressed in live AG-UI, snapshots and restored history`, () => {
    const item: any = {
      id: "tool",
      type: "mcpToolCall",
      server: "fixture",
      tool: "check",
      status: variant === "native-error" ? "completed" : "failed",
      arguments: {},
      error:
        variant === "native-error" ? { message: "认证失败：" + secret } : null,
      result: {
        content: [{ type: "text", text: secret }],
        structuredContent: { private: secret },
        _meta: { private: secret },
      },
    };
    const events = new AgentEvents();
    const captured: any[] = [];
    events.on("event", (event) => captured.push(event));
    events.seed({
      id: "thread",
      turns: [{ id: "turn", status: "inProgress", items: [] }],
    });
    events.notification({
      method: "item/completed",
      params: { threadId: "thread", turnId: "turn", item },
    } as any);
    const result = captured.find((e) => e.type === EventType.TOOL_CALL_RESULT);
    assert.deepEqual(JSON.parse(result.content), { message: "工具执行失败" });
    for (const value of [
      captured,
      events.snapshot("thread"),
      publicItem(item),
      publicTurn({
        id: "turn",
        status: "failed",
        items: [item],
        error: { message: secret },
      } as any),
    ])
      assert.ok(!JSON.stringify(value).includes(secret));
  });
test("successful tool data and App-private display metadata remain usable while error App payloads use fixed text", () => {
  const good = {
    content: [{ type: "text", text: "count: 3" }],
    structuredContent: { count: 3 },
    _meta: { display: "app-only" },
  };
  assert.deepEqual(appToolResult(good), good);
  const failed = appToolResult({
    ...good,
    isError: true,
    content: [{ type: "text", text: secret }],
    structuredContent: { key: secret },
    _meta: { key: secret },
  });
  assert.equal(failed.isError, true);
  assert.ok(!JSON.stringify(failed).includes(secret));
  const view = publicItem({
    id: "tool",
    type: "mcpToolCall",
    server: "fixture",
    tool: "check",
    status: "completed",
    arguments: {},
    error: null,
    result: good,
  } as any);
  assert.equal(view.result.structuredContent.count, 3);
  assert.equal(view.result._meta, undefined);
});
test("Broker normalizes consumer outcomes and discards thrown causes, custom names and unknown fields", async () => {
  for (const mode of ["throw", "outcome"]) {
    const broker = credentialBroker({
      validOwner: () => true,
      audit: () => {},
      prepare: async () => ({
        receiver: "fixed trusted receiver",
        run: async () => {
          if (mode === "throw")
            throw Object.assign(new Error(secret), {
              name: secret,
              cause: { key: secret },
            });
          return {
            state: "failed",
            reason: secret,
            applied: secret,
            passwordUsed: secret,
            echo: secret,
          } as any;
        },
      }),
    });
    try {
      const ticket = await broker.create("owner", {
        operation: "sudo.identity",
        requestId: randomUUID(),
        expectedPolicy: "sudo1." + "0".repeat(64),
      });
      const bytes = Buffer.from(secret);
      const result = await broker.fulfill(ticket.id, "owner", bytes);
      assert.equal(result.reason, "unavailable");
      assert.equal(result.state, "failed");
      assert.ok(bytes.every((v) => !v));
      assert.ok(!JSON.stringify(result).includes(secret));
      assert.ok(
        !JSON.stringify(broker.read(ticket.id, "owner")).includes(secret),
      );
    } finally {
      broker.close();
    }
  }
});
for (const failure of ["version", "initialize"])
  test(`native ${failure} diagnostics and stderr never become runtime reasons`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "newbot-isolation-codex-")),
      binary = join(directory, "fixture-codex");
    const prior = process.env.CODEX_BIN;
    writeFileSync(
      binary,
      `#!${process.execPath}\nif(process.argv.includes('--version')){${failure === "version" ? `process.stderr.write(${JSON.stringify(secret)});process.exit(1);` : `console.log(${JSON.stringify(CODEX_VERSION)});process.exit(0);`}}\nprocess.stderr.write(${JSON.stringify(secret)});let data='';process.stdin.on('data',b=>{data+=b;let i;while((i=data.indexOf('\\n'))>=0){const line=data.slice(0,i);data=data.slice(i+1);const req=JSON.parse(line);console.log(JSON.stringify({id:req.id,error:{code:-32000,message:${JSON.stringify("连接失败：" + secret)}}}));}});`,
      { mode: 0o700 },
    );
    const runtime = new Codex(directory);
    const statuses: string[] = [];
    runtime.on("status", () => statuses.push(runtime.reason));
    try {
      process.env.CODEX_BIN = binary;
      await runtime.start();
      assert.equal(runtime.state, "offline");
      assert.ok(runtime.reason.length);
      assert.ok(!JSON.stringify(statuses).includes(secret));
    } finally {
      await runtime.stopAndWait();
      if (prior === undefined) delete process.env.CODEX_BIN;
      else process.env.CODEX_BIN = prior;
      rmSync(directory, { recursive: true, force: true });
    }
  });
test("Trace metadata uses fixed names and classifications and opaque correlatable IDs", () => {
  const error = Object.assign(new TypeError(secret), { name: secret });
  assert.equal(traceErrorType(error), "TypeError");
  assert.equal(
    traceErrorType(Object.assign(new Error(secret), { name: secret })),
    "Error",
  );
  assert.equal(traceOperation(secret), "bridge.operation");
  assert.equal(
    traceOperation("bridge.credentials.consume"),
    "bridge.credentials.consume",
  );
  assert.equal(traceTurnStatus(secret), "unknown");
  assert.equal(traceIdentifier(secret), traceIdentifier(secret));
  assert.ok(!traceIdentifier(secret).includes(secret));
  assert.notEqual(traceIdentifier(secret), traceIdentifier("other"));
});
