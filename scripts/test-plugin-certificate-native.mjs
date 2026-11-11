// Isolated integration of the published plugin, real Codex, and synthetic TLS API.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, networkInterfaces } from "node:os";
import { createServer as httpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash, X509Certificate } from "node:crypto";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
import { certificateAddress } from "../server/certificates.ts";
const output = resolve(
  process.env.CERTIFICATE_EVIDENCE ||
    ".issue/2026-11-10/evidence-plugin-mcpb-certificate",
);
await mkdir(output, { recursive: true });
const archive = resolve(
  process.argv[2] ||
    "/home/a/Documents/ChatGPT/newapp/dist/cloudwalker-0.5.2-linux-amd64.zip",
);
const root = await mkdtemp(join(tmpdir(), "newbot-certificate-native-")),
  cwd = join(root, "work"),
  home = join(root, "codex");
await mkdir(cwd);
await mkdir(home);
const address = Object.values(networkInterfaces())
  .flat()
  .find(
    (a) => a?.family === "IPv4" && !a.internal && certificateAddress(a.address),
  )?.address;
assert.ok(
  address,
  "needs a local non-loopback address for the actual guarded TLS endpoint",
);
const keyFile = join(root, "key.pem"),
  certFile = join(root, "cert.pem");
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
    "/CN=synthetic",
    "-addext",
    `subjectAltName=IP:${address}`,
    "-keyout",
    keyFile,
    "-out",
    certFile,
  ],
  { stdio: "ignore" },
);
const cert = await readFile(certFile),
  expectedPin = new X509Certificate(cert).fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
const secret = "synthetic-host-private-token-not-for-real-service";
let businessCalls = 0;
const sockets = new Set();
const upstream = httpsServer(
  { key: await readFile(keyFile), cert },
  async (req, res) => {
    businessCalls++;
    assert.equal(req.headers.cookie, `API-Token=${secret}`);
    let raw = "";
    for await (const b of req) raw += b;
    const data = JSON.parse(raw);
    assert.equal(data.method, "BusinessGroupService.GetBusinessGroupTree");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: data.id,
        result: {
          tree: [
            { id: 1, pid: 0, oid: 1, name: "CERTIFICATE_PROOF", children: [] },
          ],
        },
      }),
    );
  },
);
upstream.on("connection", (s) => {
  sockets.add(s);
  s.once("close", () => sockets.delete(s));
});
upstream.on("tlsClientError", () => {});
await new Promise((r) => upstream.listen(0, address, r));
const base = `https://${address}:${upstream.address().port}`;
process.env.ENABLE_TEST_MCP = "false";
process.env.EXPERIMENTAL_PLUGINS = "true";
let ctx,
  headers,
  stage = "startup";
const checks = [];
const pluginId = "cloudwalker@newbot-imports",
  origin = "http://127.0.0.1:3100";
async function open() {
  const codex = new Codex(cwd, () => ({ CODEX_HOME: home }));
  ctx = await createServer({
    directory: root,
    cwd,
    codex,
    providerRuntime: new ProviderRuntime(),
    password: "synthetic-certificate-test",
  });
  await codex.start();
  assert.equal(codex.state, "ready");
  await ctx.service.configuration.read();
  const runtime = codex.providerRuntime,
    snapshot = runtime.snapshot();
  if (!snapshot.values.model_providers?.fixture)
    runtime.apply(snapshot.revision, [
      {
        keyPath: "model_providers",
        value: {
          fixture: {
            name: "Fixture",
            base_url: "http://127.0.0.1:1",
            wire_api: "responses",
            requires_openai_auth: false,
          },
        },
        mergeStrategy: "replace",
      },
      { keyPath: "model_provider", value: "fixture", mergeStrategy: "replace" },
      { keyPath: "model", value: "gpt-6.1-sol", mergeStrategy: "replace" },
    ]);
  headers = { origin, cookie: `ma_session=${ctx.db.createSession()}` };
}
const post = (url, payload) =>
  ctx.app.inject({ method: "POST", url, headers, payload });
async function connection() {
  return (await ctx.service.plugins.read(pluginId)).connections[0];
}
async function save(pin) {
  const c = await connection(),
    requestId = randomUUID();
  const r = await post("/api/credentials/requests", {
    operation: "plugin.configuration.save",
    requestId,
    pluginId,
    connectionId: c.id,
    expectedRevision: c.revision,
    schemaDigest: c.schemaDigest,
    values: { base_url: base, tls_certificate_sha256: pin },
    enabled: true,
    clearSecrets: [],
  });
  assert.equal(r.json().state, "waiting", r.body);
  const result = await ctx.app.inject({
    method: "POST",
    url: `/api/credentials/${requestId}/input`,
    headers: { ...headers, "content-type": "application/octet-stream" },
    payload: Buffer.from(JSON.stringify({ api_token: secret })).toString(
      "base64",
    ),
  });
  assert.equal(result.json().state, "succeeded", result.body);
}
async function tool() {
  const thread = await ctx.service.handle("thread/start", {
    provider: "fixture",
    model: "gpt-6.1-sol",
  });
  const c = await connection();
  const status = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: thread.id,
  });
  const entry = status.data.find((v) => v.name === c.id);
  assert.ok(entry, "owned connector is available to native thread");
  assert.equal(Object.keys(entry.tools).length, 7);
  return ctx.runtime.call("mcpServer/tool/call", {
    threadId: thread.id,
    server: c.id,
    tool: "list_business_groups",
    arguments: {},
  });
}
try {
  await open();
  stage = "import";
  const bytes = await readFile(archive),
    session = await ctx.imports.create({
      kind: "zip",
      name: "CloudWalker MCPB",
    });
  await ctx.imports.upload(session.id, "", bytes, true);
  const scan = await ctx.imports.scan(session.id);
  assert.equal(scan.entries.length, 1);
  assert.equal(scan.entries[0].skills.length, 2);
  const done = await ctx.imports.install(scan.id, {
    operationId: randomUUID(),
    digest: scan.digest,
    choices: scan.entries.map((e) => ({
      id: e.id,
      skills: e.skills.map((s) => s.id),
      confirmPackage: true,
      replace: false,
    })),
  });
  assert.equal(done.entries[0].state, "installed", JSON.stringify(done));
  const detail = await ctx.service.plugins.read(pluginId),
    c = detail.connections[0];
  assert.equal(detail.version, "0.5.2");
  assert.equal(detail.skills.length, 2);
  assert.deepEqual(c.fields.map((f) => f.id).sort(), [
    "api_token",
    "base_url",
    "tls_certificate_sha256",
  ]);
  assert.match(c.reason, /缺少/);
  assert.equal(c.configured, false);
  checks.push(
    "published MCPB ZIP imports as one plugin with both skills, three declared fields and seven native tools",
  );
  stage = "certificate-api";
  const p = {
    pluginId,
    connectionId: c.id,
    expectedRevision: c.revision,
    schemaDigest: c.schemaDigest,
    fieldId: "base_url",
    address: base,
  };
  assert.equal(
    (
      await ctx.app.inject({
        method: "POST",
        url: "/api/plugins/certificate",
        headers: { origin },
        payload: p,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await ctx.app.inject({
        method: "POST",
        url: "/api/plugins/certificate",
        headers: { ...headers, origin: "https://untrusted.invalid" },
        payload: p,
      })
    ).statusCode,
    403,
  );
  assert.ok(
    (await post("/api/plugins/certificate", { ...p, fieldId: "api_token" }))
      .statusCode >= 400,
  );
  assert.ok(
    (
      await post("/api/plugins/certificate", {
        ...p,
        address: "http://service.example",
      })
    ).statusCode >= 400,
  );
  assert.ok(
    (
      await post("/api/plugins/certificate", {
        ...p,
        address: "https://169.254.169.254",
      })
    ).statusCode >= 400,
  );
  const reply = await post("/api/plugins/certificate", p);
  assert.equal(reply.statusCode, 200, reply.body);
  const observed = reply.json();
  assert.equal(observed.fingerprint, expectedPin);
  assert.equal(observed.systemTrusted, false);
  assert.equal(observed.canUse, true);
  assert.equal((await connection()).revision, c.revision);
  assert.equal(businessCalls, 0);
  checks.push(
    "guarded certificate API observes a self-signed TLS endpoint without HTTP, credentials, or configuration writes; auth/origin/private-field/HTTP/metadata rejection verified",
  );
  stage = "native-tls";
  await save("");
  const failed = await tool();
  assert.match(JSON.stringify(failed), /tls_certificate/);
  assert.equal(businessCalls, 0);
  await save(observed.fingerprint);
  const good = await tool();
  assert.match(JSON.stringify(good), /CERTIFICATE_PROOF/);
  assert.equal(businessCalls, 1);
  assert.ok(!JSON.stringify(good).includes(secret));
  await save("0".repeat(64));
  const wrong = await tool();
  assert.match(JSON.stringify(wrong), /tls_certificate/);
  assert.equal(businessCalls, 1);
  checks.push(
    "real native MCP rejects system-untrusted and wrong-pin TLS before sending token; confirmed observed pin enables only the synthetic target and yields business data",
  );
  stage = "restart";
  await save(observed.fingerprint);
  await ctx.app.close();
  await open();
  assert.equal((await connection()).configured, true);
  assert.equal(
    (await connection()).fields.find((f) => f.id === "tls_certificate_sha256")
      .value,
    observed.fingerprint,
  );
  assert.match(JSON.stringify(await tool()), /CERTIFICATE_PROOF/);
  assert.equal(businessCalls, 2);
  assert.equal(
    (await ctx.service.configuration.read()).publicView.mcp.length,
    0,
  );
  assert.equal(
    await readFile(join(home, "config.toml"), "utf8").catch(() => ""),
    "",
  );
  checks.push(
    "SQLite settings and encrypted token restore after restart; plugin connector remains out of independent catalog; no config.toml preferences",
  );
  await writeFile(
    join(output, "native-certificate.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version: "0.165.0",
        pluginVersion: detail.version,
        archiveSha256: createHash("sha256").update(bytes).digest("hex"),
        modelRequests: 0,
        realBusinessRequests: 0,
        syntheticBusinessRequests: businessCalls,
        checks,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      syntheticBusinessRequests: businessCalls,
    }),
  );
} catch (e) {
  await writeFile(
    join(output, "native-certificate-failure.json"),
    JSON.stringify(
      { stage, error: String(e), stack: e.stack, checks },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await ctx?.app.close().catch(() => {});
  for (const socket of sockets) socket.destroy();
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await rm(root, { recursive: true, force: true });
}
