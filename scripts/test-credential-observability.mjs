import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
const output = resolve(".data/credential-isolation");
mkdirSync(output, { recursive: true, mode: 0o700 });
const markers = [
  "credential-fixture-private-value-ONLY-TEST",
  "D65_MCP_PRIVATE_ONLY_TEST",
  "test sudo 私密 password",
  "D65_DIAGNOSTIC_PRIVATE_ONLY_TEST",
  "private-fixture-password",
  "SYNTHETIC_CONFIG_SECRET_DO_NOT_EXPOSE",
];
const exports = [];
const collector = createServer((req, res) => {
  const parts = [];
  req.on("data", (v) => parts.push(v));
  req.on("end", () => {
    const raw = Buffer.concat(parts);
    exports.push(
      req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw,
    );
    res.setHeader("Content-Type", "application/json");
    res.end("{}");
  });
});
await new Promise((r) => collector.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${collector.address().port}/v1/traces`;
async function child(args) {
  const proc = spawn(process.execPath, args, {
    env: {
      ...process.env,
      NODE_ENV: "development",
      NODE_TEST_CONTEXT: "",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
      OTEL_RESOURCE_ATTRIBUTES: "private.test=D65_DIAGNOSTIC_PRIVATE_ONLY_TEST",
      OTEL_SERVICE_NAME: "D65_DIAGNOSTIC_PRIVATE_ONLY_TEST",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  proc.stdout.on("data", (d) => (stdout += d));
  proc.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => proc.kill("SIGKILL"), 35_000);
  const code = await new Promise((res, rej) => {
    proc.on("error", rej);
    proc.on("close", res);
  });
  clearTimeout(timer);
  for (const value of [stdout, stderr])
    for (const marker of markers)
      assert.ok(!value.includes(marker), "Credential leaked to a process log");
  if (code !== 0) {
    writeFileSync(resolve(output, "observability-failure.log"), stderr, {
      mode: 0o600,
    });
    throw new Error("Observability fixture failed; see private diagnostics");
  }
  return { stdout, stderr };
}
try {
  const result = await child([
    "--import",
    "tsx",
    "tests/credential-observability-probe.ts",
  ]);
  const record = JSON.parse(
    result.stdout
      .split("\n")
      .find((v) => v.startsWith("D65_RESULT "))
      .slice(11),
  );
  const logs = result.stdout
    .split("\n")
    .filter((v) => v.startsWith("{"))
    .map((v) => JSON.parse(v));
  assert.ok(logs.length > 20);
  for (const log of logs) {
    assert.ok(["http.request", "runtime.status"].includes(log.event));
    assert.ok(!("url" in log));
    assert.ok(!("headers" in log));
    assert.ok(!("body" in log));
    assert.ok(!("message" in log));
  }
  const policy = await child([
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    `
 const {telemetry}=await import('./server/telemetry.ts');const t=await telemetry();
 const secret='D65_DIAGNOSTIC_PRIVATE_ONLY_TEST';
 for(const err of [Object.assign(new Error(secret),{name:secret}),Object.assign(new TypeError(secret),{name:secret}),secret]){try{await t.operation('bridge.agent.action',async()=>{throw err});}catch{}}
 await t.operation(secret,async()=>secret);t.turnStart(secret,secret);t.turnEnd(secret,secret);await t.close();
 `,
  ]);
  assert.ok(exports.length > 0);
  const spans = [];
  for (const bytes of exports) {
    const text = bytes.toString();
    for (const marker of markers)
      for (const variant of [
        marker,
        encodeURIComponent(marker),
        Buffer.from(marker).toString("base64"),
      ])
        assert.ok(!text.includes(variant), "Credential leaked to OTLP payload");
    const data = JSON.parse(text);
    for (const resource of data.resourceSpans || []) {
      for (const attr of resource.resource?.attributes || [])
        assert.ok(
          [
            "service.name",
            "telemetry.sdk.name",
            "telemetry.sdk.language",
            "telemetry.sdk.version",
          ].includes(attr.key),
        );
      for (const scope of resource.scopeSpans || []) spans.push(...scope.spans);
    }
  }
  const names = new Set([
    "bridge.config.read",
    "bridge.agent.run",
    "bridge.agent.action",
    "bridge.credentials.consume",
    "bridge.operation",
    "agent.turn",
  ]);
  const keys = new Set([
    "conversation.id",
    "run.id",
    "agent.turn.status",
    "error.type",
  ]);
  for (const span of spans) {
    assert.ok(names.has(span.name));
    assert.equal((span.events || []).length, 0);
    for (const attr of span.attributes || []) {
      assert.ok(keys.has(attr.key));
      const value = attr.value.stringValue;
      if (attr.key === "error.type")
        assert.ok(
          ["Error", "TypeError", "RangeError", "SyntaxError"].includes(value),
        );
      if (attr.key.endsWith(".id"))
        assert.match(value, /^sha256:[a-f0-9]{64}$/);
      if (attr.key === "agent.turn.status")
        assert.ok(
          [
            "completed",
            "failed",
            "interrupted",
            "process_stopped",
            "unknown",
          ].includes(value),
        );
    }
  }
  assert.ok(spans.some((v) => v.name === "bridge.credentials.consume"));
  assert.ok(spans.some((v) => v.name === "agent.turn"));
  assert.ok(spans.some((v) => v.name === "bridge.operation"));
  assert.ok(spans.some((v) => v.status?.code === 2));
  const report = {
    ...record,
    operationalLogs: logs.length,
    otlpBatches: exports.length,
    spans: spans.length,
    logsClean: true,
    otlpClean: true,
    errorNamesClosed: true,
    identifiersHashed: true,
    resourceDetectionDisabled: true,
  };
  writeFileSync(
    resolve(output, "observability-result.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  rmSync(resolve(output, "observability-failure.log"), { force: true });
  console.log(JSON.stringify(report));
} finally {
  collector.closeAllConnections();
  await new Promise((r) => collector.close(r));
}
