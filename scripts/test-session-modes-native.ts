import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { Codex } from "../server/codex";
import { createServer } from "../server/index";
const root = await mkdtemp(join(tmpdir(), "newbot-mode-product-"));
const output = resolve(
  process.env.MODE_EVIDENCE_DIR || ".data/mode-verification",
);
await mkdir(output, { recursive: true });
const steps: any[] = [],
  bodies: any[] = [],
  calls = { read: 0, write: 0, mislabelled_read: 0 };
let descriptionVersion = 1;
const tools = () =>
  Object.keys(calls).map((name) => ({
    name,
    description: `Synthetic ${name} v${descriptionVersion}`,
    inputSchema: { type: "object", properties: {} },
    annotations:
      name === "read"
        ? undefined
        : { readOnlyHint: name !== "write", destructiveHint: name === "write" },
  }));
const upstream = httpServer(async (req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  let raw = "";
  for await (const c of req) raw += c;
  const data = JSON.parse(raw);
  if (req.url?.endsWith("/responses")) {
    bodies.push(data);
    const step = steps.shift() || {};
    await step.wait;
    const item = step.item || {
      type: "message",
      id: "msg_" + randomUUID(),
      role: "assistant",
      status: "completed",
      content: [
        { type: "output_text", text: "Synthetic complete.", annotations: [] },
      ],
    };
    const response = {
      id: "resp_" + randomUUID(),
      object: "response",
      status: "completed",
      model: data.model,
      output: [item],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    };
    res.setHeader("content-type", "text/event-stream");
    for (const event of [
      {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    ])
      res.write("data: " + JSON.stringify(event) + "\n\n");
    res.end();
    return;
  }
  if (!("id" in data)) {
    res.writeHead(202).end();
    return;
  }
  let result: any = {};
  if (data.method === "initialize")
    result = {
      protocolVersion: data.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "mode-probe", version: "1" },
    };
  if (data.method === "tools/list") result = { tools: tools() };
  if (data.method === "resources/list") result = { resources: [] };
  if (data.method === "resources/templates/list")
    result = { resourceTemplates: [] };
  if (data.method === "prompts/list") result = { prompts: [] };
  if (data.method === "tools/call") {
    const name = data.params.name as keyof typeof calls;
    calls[name]++;
    result = {
      content: [
        { type: "text", text: JSON.stringify({ name, count: calls[name] }) },
      ],
    };
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", id: data.id, result }));
});
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
const port = (upstream.address() as any).port;
const home = join(root, "codex"),
  work = join(root, "work");
await mkdir(home);
await mkdir(work);
await writeFile(
  join(home, "config.toml"),
  `model="gpt-6.1-sol"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:${port}"\nwire_api="responses"\nrequires_openai_auth=false\n[mcp_servers.probe]\nurl="http://127.0.0.1:${port}/mcp"\n`,
);
let native: Codex;
let ctx: Awaited<ReturnType<typeof createServer>>;
let headers: any;
const report: any = {
  scope:
    "Product HTTP -> real isolated Codex -> synthetic loopback model/MCP; no production credentials",
  checks: [],
};
async function open() {
  native = new Codex(work, () => ({ HOME: root, CODEX_HOME: home }));
  const rpc = native.call.bind(native);
  native.call = (async (method: any, params: any) => {
    try {
      return await rpc(method, params);
    } catch (error) {
      console.error("NATIVE", method, String(error));
      throw error;
    }
  }) as typeof native.call;
  ctx = await createServer({
    directory: join(root, "data"),
    cwd: work,
    codex: native,
    providerRuntime: null,
    password: "mode-fixture-login",
    origins: ["http://localhost:3100"],
  });
  await native.start();
  assert.equal(native.state, "ready");
  createInterface({ input: native.child!.stdout }).on("line", (line) => {
    try {
      const v = JSON.parse(line);
      if (v.error) console.error("RAW SYNTHETIC", JSON.stringify(v.error));
    } catch {}
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost:3100" },
    payload: { password: "mode-fixture-login" },
  });
  headers = {
    origin: "http://localhost:3100",
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
}
async function post(url: string, payload: any) {
  const r = await ctx.app.inject({ method: "POST", url, headers, payload });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const action = (action: string, p: any = {}) =>
  post("/api/agent/action", { action, ...p });
async function until(fn: () => any) {
  for (let i = 0; i < 400; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("completion timed out");
}
async function run(p: any = {}) {
  const r = await post("/api/agent/run", {
    requestId: randomUUID(),
    text: "MODE_HISTORY_MARKER",
    ...p,
  });
  await until(() => !native.active.has(r.threadId));
  return r;
}
const tool = (name: string, args: any, namespace?: string) => ({
  type: "function_call",
  id: "fc_" + randomUUID(),
  call_id: "call_" + randomUUID(),
  name,
  arguments: JSON.stringify(args),
  ...(namespace ? { namespace } : {}),
});
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  report.checks.push(name);
  console.log("PASS", name);
}
let first: any;
try {
  await open();
  await check(
    "new sessions default to chat and cannot dispatch shell commands",
    async () => {
      steps.push(
        {
          item: tool("exec_command", {
            cmd: `printf changed > ${work}/marker.txt`,
          }),
        },
        {},
      );
      first = await run();
      assert.equal(
        ctx.service.runtimeSettings.get(first.threadId).mode,
        "chat",
      );
      await assert.rejects(readFile(join(work, "marker.txt")));
    },
  );
  await check("unreviewed and mislabelled MCP writes are denied", async () => {
    await assert.rejects(
      native.call("mcpServer/tool/call", {
        threadId: first.threadId,
        server: "probe",
        tool: "mislabelled_read",
        arguments: {},
      }),
    );
    assert.equal(calls.mislabelled_read, 0);
  });
  await check(
    "reviewed read-only MCP is usable through the model",
    async () => {
      const catalog = await action("mode/tools/read", { server: "probe" });
      await action("mode/tools/update", {
        server: "probe",
        expectedRevision: catalog.revision,
        tools: ["read"],
      });
      steps.push({ item: tool("read", {}, "mcp__probe") }, {});
      await run({ threadId: first.threadId });
      assert.equal(calls.read, 1);
    },
  );
  await check("plan preserves history and blocks file writes", async () => {
    const r = ctx.service.runtimeSettings.get(first.threadId);
    await action("session/update", {
      threadId: first.threadId,
      expectedRevision: r.revision,
      mode: "plan",
    });
    steps.push(
      {
        item: tool("exec_command", {
          cmd: `printf changed > ${work}/marker.txt`,
        }),
      },
      {},
    );
    await run({ threadId: first.threadId });
    await assert.rejects(readFile(join(work, "marker.txt")));
    assert(
      bodies
        .at(-1)
        .input.some((x: any) =>
          JSON.stringify(x).includes("MODE_HISTORY_MARKER"),
        ),
    );
  });
  await check(
    "restart reapplies the persisted mode and tool policy",
    async () => {
      await native.stopAndWait();
      await ctx.app.close();
      await open();
      await ctx.service.handle("thread/resume", { threadId: first.threadId });
      assert.equal(
        ctx.service.runtimeSettings.get(first.threadId).mode,
        "plan",
      );
      await native.call("mcpServer/tool/call", {
        threadId: first.threadId,
        server: "probe",
        tool: "read",
        arguments: {},
      });
      await assert.rejects(
        native.call("mcpServer/tool/call", {
          threadId: first.threadId,
          server: "probe",
          tool: "write",
          arguments: {},
        }),
      );
      assert.equal(calls.write, 0);
    },
  );
  await check("changed tool definitions require renewed review", async () => {
    descriptionVersion++;
    await native.unload(first.threadId);
    await ctx.service.handle("thread/resume", { threadId: first.threadId });
    const r = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload: {
        threadId: first.threadId,
        requestId: randomUUID(),
        text: "changed tool",
      },
    });
    assert.notEqual(r.statusCode, 200, r.body);
  });
  await check(
    "work uses saved approval and keeps the same thread",
    async () => {
      const r = ctx.service.runtimeSettings.get(first.threadId);
      await action("session/update", {
        threadId: first.threadId,
        expectedRevision: r.revision,
        mode: "work",
        approval: "full",
      });
      steps.push(
        {
          item: tool("exec_command", {
            cmd: `printf changed > ${work}/marker.txt`,
          }),
        },
        {},
      );
      const result = await run({ threadId: first.threadId });
      assert.equal(result.threadId, first.threadId);
      assert.equal(await readFile(join(work, "marker.txt"), "utf8"), "changed");
    },
  );

  const revised = await action("mode/tools/read", { server: "probe" });
  await action("mode/tools/update", {
    server: "probe",
    expectedRevision: revised.revision,
    tools: ["read"],
  });
  await check(
    "busy mode change applies next turn, never relabels the running work",
    async () => {
      let release!: () => void;
      const wait = new Promise<void>((r) => (release = r));
      steps.push(
        {
          item: tool("exec_command", {
            cmd: `printf old > ${work}/old-turn.txt`,
          }),
          wait,
        },
        {},
      );
      const before = bodies.length;
      const active = await post("/api/agent/run", {
        threadId: first.threadId,
        requestId: randomUUID(),
        text: "hold current work",
      });
      await until(() => bodies.length > before);
      const r = ctx.service.runtimeSettings.get(first.threadId);
      const changed = await action("session/update", {
        threadId: first.threadId,
        expectedRevision: r.revision,
        mode: "chat",
      });
      assert.equal(changed.mode, "chat");
      assert.equal(changed.applied.mode, "work");
      release();
      await until(() => !native.active.has(first.threadId));
      assert.equal(await readFile(join(work, "old-turn.txt"), "utf8"), "old");
      steps.push(
        {
          item: tool("exec_command", {
            cmd: `printf bad > ${work}/next-turn.txt`,
          }),
        },
        {},
      );
      await run({ threadId: first.threadId });
      await assert.rejects(readFile(join(work, "next-turn.txt")));
      assert.equal(
        ctx.service.runtimeSettings.applied(first.threadId).mode,
        "chat",
      );
    },
  );
  await check(
    "a forged MCP write cannot bypass the model tool allowlist",
    async () => {
      steps.push({ item: tool("write", {}, "mcp__probe") }, {});
      await run({ threadId: first.threadId });
      assert.equal(calls.write, 0);
    },
  );
  await check(
    "work in another thread remains independently authorized",
    async () => {
      const other = await run({ mode: "work", approval: "full" });
      await native.call("mcpServer/tool/call", {
        threadId: other.threadId,
        server: "probe",
        tool: "write",
        arguments: {},
      });
      assert.equal(calls.write, 1);
      assert.equal(
        ctx.service.runtimeSettings.applied(first.threadId).mode,
        "chat",
      );
    },
  );
  await check(
    "new chat policy binds the receiver before credential hydration",
    async () => {
      const original = native.privateConfiguration;
      native.privateConfiguration = async (params) => {
        const hydrated = original ? await original(params) : params;
        return {
          ...hydrated,
          config: {
            ...hydrated.config,
            mcp_servers: {
              ...hydrated.config?.mcp_servers,
              probe: {
                ...hydrated.config?.mcp_servers?.probe,
                http_headers: { Authorization: "Bearer SYNTHETIC_FIXTURE" },
              },
            },
          },
        };
      };
      steps.push({ item: tool("read", {}, "mcp__probe") }, {});
      const before = calls.read;
      try {
        await run({ mode: "chat" });
        assert.equal(calls.read, before + 1);
      } finally {
        native.privateConfiguration = original;
      }
    },
  );
  report.completed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await writeFile(
    join(output, "native-product.json"),
    JSON.stringify({ ...report, calls, modelRequests: bodies.length }, null, 2),
  );
  if (native!) await native.stopAndWait();
  if (ctx!) await ctx.app.close();
  upstream.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
  await rm(root, { recursive: true, force: true });
}
