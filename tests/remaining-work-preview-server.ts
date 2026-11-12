// Isolated browser acceptance. Real pinned Codex/SQLite/import/TLS; synthetic model.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, networkInterfaces } from "node:os";
import { execFileSync } from "node:child_process";
import { createServer as http, request as httpRequest } from "node:http";
import { createServer as tls } from "node:tls";
import { createServer as tcp, connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { Codex } from "../server/codex.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { certificateAddress } from "../server/certificates.js";

const root = await mkdtemp(join(tmpdir(), "newbot-remaining-ui-"));
const cwd = join(root, "work"),
  home = join(root, "codex"),
  counter = join(root, "once.txt");
await mkdir(cwd);
await mkdir(home);
const port = 3147,
  publicPort = 3148,
  origin = `http://127.0.0.1:${publicPort}`;
const address = Object.values(networkInterfaces())
  .flat()
  .find(
    (a) => a?.family === "IPv4" && !a.internal && certificateAddress(a.address),
  )?.address;
assert.ok(address);
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Isolated test server",
    "-addext",
    `subjectAltName=IP:${address}`,
    "-keyout",
    join(root, "key.pem"),
    "-out",
    join(root, "cert.pem"),
  ],
  { stdio: "ignore" },
);
let tlsApplicationBytes = 0,
  tlsConnections = 0;
const tlsSockets = new Set<Socket>();
const secure = tls(
  {
    key: await readFile(join(root, "key.pem")),
    cert: await readFile(join(root, "cert.pem")),
  },
  (s) => {
    tlsConnections++;
    s.on("data", (b) => (tlsApplicationBytes += b.length));
  },
);
secure.on("connection", (s) => {
  tlsSockets.add(s);
  s.once("close", () => tlsSockets.delete(s));
});
secure.on("tlsClientError", () => {});
await new Promise<void>((r) => secure.listen(0, address, r));
const tlsPort = (secure.address() as any).port;
const delayedSockets = new Set<Socket>();
const delayed = tcp((s) => {
  delayedSockets.add(s);
  s.once("close", () => delayedSockets.delete(s));
});
await new Promise<void>((r) => delayed.listen(0, address, r));
let requests = 0,
  release: (() => void) | undefined,
  completed = 0;
const gateway = http(async (req, res) => {
  if (req.url?.endsWith("/models")) {
    res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
    return;
  }
  let raw = "";
  for await (const b of req) raw += b;
  const body = JSON.parse(raw),
    index = ++requests;
  if (index % 2 === 0) await new Promise<void>((r) => (release = r));
  const item =
    index % 2 === 1
      ? {
          type: "function_call",
          id: `fc_${index}`,
          call_id: `call_${index}`,
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: `printf one >> '${counter}'`,
            max_output_tokens: 100,
            ...(process.env.RECOVERY_APPROVAL_TEST === "1"
              ? {
                  sandbox_permissions: "require_escalated",
                  justification: "仅写入隔离测试计数文件，验证审批恢复。",
                }
              : {}),
          }),
        }
      : {
          type: "message",
          id: `msg_${index}`,
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: `恢复测试完成 ${index / 2}，工具只执行一次。`,
              annotations: [],
            },
          ],
        };
  const response = {
    id: `resp_${index}`,
    object: "response",
    status: "completed",
    model: body.model,
    output: [item],
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
  };
  res.writeHead(200, { "content-type": "text/event-stream" });
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
});
await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
process.env.EXPERIMENTAL_PLUGINS = "true";
const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
const ctx = await createServer({
  directory: root,
  cwd,
  codex: native,
  providerRuntime: new ProviderRuntime(),
  password: "remaining-ui-fixture",
  origins: [origin],
  webDirectory: resolve(process.env.UI_TEST_CANDIDATE || "dist/web"),
});
native.on("event", (e) => {
  if (e.method === "turn/completed") completed++;
});
await native.start();
assert.equal(native.state, "ready");
const pr = native.providerRuntime!;
pr.apply(pr.revision, [
  {
    keyPath: "model_providers",
    mergeStrategy: "replace",
    value: {
      fixture: {
        name: "隔离测试网关",
        base_url: `http://127.0.0.1:${(gateway.address() as any).port}`,
        wire_api: "responses",
        requires_openai_auth: false,
      },
    },
  },
  { keyPath: "model_provider", value: "fixture", mergeStrategy: "replace" },
  { keyPath: "model", value: "gpt-6.1-sol", mergeStrategy: "replace" },
]);
const session = await ctx.imports.create({
  kind: "files",
  name: "配置验收插件",
});
const files: Record<string, string> = {
  "plugin.json": JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "acceptance",
    version: "1.0.0",
    description: "仅在隔离环境验证配置、证书和技能归属",
    interface: {
      displayName: "配置验收插件",
      shortDescription: "配置、证书和技能归属测试",
    },
  }),
  "mcp.json": JSON.stringify({
    mcpServers: {
      probe: { command: process.execPath, args: ["${PLUGIN_ROOT}/main.mjs"] },
    },
  }),
  "manifest.json": JSON.stringify({
    manifest_version: "0.3",
    name: "probe",
    version: "1.0.0",
    description: "隔离测试连接器",
    author: { name: "Test" },
    server: {
      type: "node",
      entry_point: "main.mjs",
      mcp_config: {
        command: process.execPath,
        args: ["${__dirname}/main.mjs"],
        env: {
          TARGET: "${user_config.url}",
          KEY: "${user_config.key}",
          PIN: "${user_config.pin}",
        },
      },
    },
    user_config: {
      url: { type: "string", title: "服务地址", required: true },
      key: {
        type: "string",
        title: "访问密钥",
        sensitive: true,
        required: true,
      },
      pin: { type: "string", title: "证书指纹", default: "" },
    },
  }),
  "skills/check/SKILL.md":
    "---\nname: acceptance-check\ndescription: 插件内部的验收技能\n---\nThis is an isolated test skill.\n",
  "main.mjs": `import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;const result=r.method==='initialize'?{protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}}:r.method==='tools/list'?{tools:[{name:'probe',title:'检查连接',description:'隔离测试',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'ok'}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`,
};
for (const [p, v] of Object.entries(files))
  await ctx.imports.upload(session.id, p, Buffer.from(v));
const scan = await ctx.imports.scan(session.id);
assert.equal(scan.entries[0].kind, "plugin");
const installed = await ctx.imports.install(scan.id, {
  operationId: randomUUID(),
  digest: scan.digest!,
  choices: scan.entries.map((e) => ({
    id: e.id,
    skills: e.skills.map((s) => s.id),
    confirmPackage: true,
    replace: false,
  })),
});
assert.equal(
  installed.entries[0].state,
  "installed",
  JSON.stringify(installed),
);
let holdDiagnostic = false,
  releaseDiagnostic: (() => void) | undefined;
const handle = ctx.service.handle.bind(ctx.service);
ctx.service.handle = (async (method: any, params: any) => {
  const result = await handle(method, params);
  if (method === "plugin/connection/test" && holdDiagnostic)
    await new Promise<void>((r) => (releaseDiagnostic = r));
  return result;
}) as typeof ctx.service.handle;
await ctx.app.listen({ port, host: "127.0.0.1" });
let offline = false;
const proxySockets = new Set<Socket>();
const proxy = http((req, res) => {
  if (offline) {
    req.socket.destroy();
    return;
  }
  const out = httpRequest(
    {
      host: "127.0.0.1",
      port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (incoming) => {
      res.writeHead(incoming.statusCode!, incoming.headers);
      incoming.pipe(res);
    },
  );
  out.on("error", () => res.destroy());
  res.on("close", () => out.destroy());
  req.pipe(out);
});
proxy.on("connection", (s) => {
  proxySockets.add(s);
  s.once("close", () => proxySockets.delete(s));
});
await new Promise<void>((r) => proxy.listen(publicPort, "127.0.0.1", r));
const state = async () => ({
  requests,
  completed,
  diagnosticHeld: !!releaseDiagnostic,
  offline,
  tlsApplicationBytes,
  tlsConnections,
  toolExecutions: (await readFile(counter, "utf8").catch(() => "")).length / 3,
  threads: ctx.db.raw.prepare("SELECT count(*) AS n FROM threads").get(),
  connection: (
    await ctx.service.pluginConnections.list("acceptance@newbot-imports")
  )[0],
});
const control = http(async (req, res) => {
  const action = req.url;
  if (req.method === "POST") {
    if (action === "/hold-diagnostic") holdDiagnostic = true;
    else if (action === "/release-diagnostic") {
      holdDiagnostic = false;
      releaseDiagnostic?.();
      releaseDiagnostic = undefined;
    } else if (action === "/offline") {
      offline = true;
      for (const s of proxySockets) s.destroy();
    } else if (action === "/online") offline = false;
    else if (action === "/finish") {
      release?.();
      release = undefined;
    } else if (action === "/release-tls")
      for (const s of delayedSockets) {
        const upstream = connect(tlsPort, address);
        s.pipe(upstream);
        upstream.pipe(s);
        s.on("close", () => upstream.destroy());
      }
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(await state()));
});
await new Promise<void>((r) => control.listen(3149, "127.0.0.1", r));
const info = {
  origin,
  password: "remaining-ui-fixture",
  certificateAddress: `https://${address}:${tlsPort}`,
  delayedAddress: `https://${address}:${(delayed.address() as any).port}`,
};
await writeFile(".data/remaining-work-fixture.json", JSON.stringify(info));
console.log("Remaining work fixture ready", JSON.stringify(info));
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void (async () => {
        release?.();
        for (const s of [...tlsSockets, ...delayedSockets, ...proxySockets])
          s.destroy();
        control.close();
        proxy.close();
        gateway.close();
        secure.close();
        delayed.close();
        await ctx.app.close();
        await rm(root, { recursive: true, force: true });
        process.exit(0);
      })(),
  );
