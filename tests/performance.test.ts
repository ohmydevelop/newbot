import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
async function child(source: string, env: NodeJS.ProcessEnv = {}) {
  return new Promise<string>((done, reject) => {
    const p = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", source],
      { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? done(out) : reject(new Error(err))));
  });
}
test("disabled telemetry does not import SDK/exporter or change operation success/failure", async () => {
  const out = await child(
    `
    import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
    const urls=[];registerHooks({load(url,c,next){urls.push(url);return next(url,c);}});
    const {telemetry}=await import('./server/telemetry.ts');const t=await telemetry();
    assert.equal(t.enabled,false);assert.equal(await t.operation('success',async()=>42),42);
    const e=new Error('synthetic-error');await assert.rejects(t.operation('failure',async()=>{throw e}),x=>x===e);
    t.turnStart('thread','turn');t.turnEnd('turn','completed');await t.close();
    assert.ok(!urls.some(u=>/opentelemetry/.test(u)));console.log('no-sdk');
  `,
    { OTEL_EXPORTER_OTLP_ENDPOINT: "", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "" },
  );
  assert.match(out, /no-sdk/);
});
test("enabled telemetry exports only allowed metadata, never synthetic prompt, result or error message", async () => {
  const payloads: Buffer[] = [];
  const collector = httpServer((req, res) => {
    req.on("data", (b) => payloads.push(b));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) =>
    collector.listen(0, "127.0.0.1", resolve),
  );
  try {
    await child(
      `
      const {telemetry}=await import('./server/telemetry.ts');const t=await telemetry();
      await t.operation('bridge.config.read',async()=> 'PROMPT_AND_RESULT_SECRET_NEVER_EXPORT');
      try {await t.operation('failed-operation',async()=>{throw new Error('ERROR_MESSAGE_SECRET_NEVER_EXPORT')});}catch{}
      t.turnStart('synthetic-thread','synthetic-turn');t.turnEnd('synthetic-turn','completed');await t.close();
    `,
      {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${(collector.address() as any).port}/v1/traces`,
      },
    );
    const text = Buffer.concat(payloads).toString();
    assert.ok(text.length > 0);
    assert.match(text, /bridge.config.read/);
    assert.match(text, /sha256:/);
    assert.ok(!text.includes("synthetic-turn"));
    assert.ok(!text.includes("SECRET_NEVER_EXPORT"));
  } finally {
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});
test(
  "precompressed static assets negotiate correctly; wildcard routing preserves authentication and API 404s",
  { skip: !existsSync("dist/web/index.html") },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "newbot-assets-"));
    const ctx = await createServer({
    providerRuntime: null,
      directory: dir,
      cwd: dir,
      codex: new FakeCodex(),
      password: "asset-test-password-only",
      origins: ["http://localhost:3100"],
    });
    try {
      assert.equal(
        statSync("dist/web").mode & 0o005,
        0o005,
        "Published static output must be readable by the runtime user",
      );
      const html = readFileSync("dist/web/index.html", "utf8");
      const src = /src="([^"]+\.js)"/.exec(html)![1];
      const raw = readFileSync("dist/web" + src);
      for (const [encoding, decode] of [
        ["br", brotliDecompressSync],
        ["gzip", gunzipSync],
      ] as const) {
        const r = await ctx.app.inject({
          url: src,
          headers: { "accept-encoding": encoding },
        });
        assert.equal(r.statusCode, 200);
        assert.match(String(r.headers["cache-control"]), /immutable/);
        assert.equal(r.headers["content-encoding"], encoding);
        assert.match(String(r.headers.vary), /Accept-Encoding/i);
        assert.deepEqual(decode(r.rawPayload), raw);
      }
      assert.equal(
        (await ctx.app.inject({ url: "/" })).headers["cache-control"],
        "no-cache",
      );
      assert.equal(
        (await ctx.app.inject({ url: "/api/not-a-real-route" })).statusCode,
        401,
      );
      const login = await ctx.app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin: "http://localhost:3100" },
        payload: { password: "asset-test-password-only" },
      });
      const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
      assert.equal(
        (
          await ctx.app.inject({
            url: "/api/not-a-real-route",
            headers: { cookie },
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (await ctx.app.inject({ url: "/assets/missing.js" })).statusCode,
        404,
      );
      assert.ok(
        !(await ctx.app.inject({ url: "/../../.env" })).body.includes(
          "ADMIN_PASSWORD=",
        ),
      );
    } finally {
      await ctx.app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
