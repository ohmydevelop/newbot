// Actual migrated instance: no listener, no public exposure, no model turns.
import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "../dist/server/index.js";
const directory = resolve(process.env.DATA_DIR || ".data"),
  dbFile = join(directory, "newbot.sqlite");
const before = new DatabaseSync(dbFile, { readOnly: true });
const passwordHash = before
  .prepare("SELECT value FROM metadata WHERE key='password'")
  .get().value;
const counts = {
  threads: before.prepare("SELECT count(*) AS n FROM threads").get().n,
  runs: before.prepare("SELECT count(*) AS n FROM runs").get().n,
};
const backupDir = join(directory, "restart-backups", "issue04-isolation-smoke");
await mkdir(backupDir, { recursive: true, mode: 0o700 });
const backupFile = join(backupDir, Date.now() + ".sqlite");
await backup(before, backupFile);
await chmod(backupFile, 0o600);
before.close();
const password =
  process.env.ADMIN_PASSWORD ||
  (existsSync(join(directory, "initial-password"))
    ? (await readFile(join(directory, "initial-password"), "utf8")).trim()
    : "");
assert.ok(password, "Existing login secret is required for the smoke check");
const [salt, digest] = passwordHash.split(":");
assert.ok(
  timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, "hex")),
  "Login secret does not match existing password; no server was started",
);
// The auth constructor must retain the existing stored hash, even if a launcher env differs.
delete process.env.ADMIN_PASSWORD;
const hash = async (path) =>
  existsSync(path)
    ? createHash("sha256")
        .update(await readFile(path))
        .digest("hex")
    : null;
const hostConfig = join(homedir(), ".codex", "config.toml"),
  hostBefore = await hash(hostConfig);
const origin = "http://127.0.0.1:3100",
  headers = { origin, host: "127.0.0.1:3100" };
const ctx = await createServer({
    providerRuntime: null,
  directory,
  cwd: resolve(process.env.AGENT_WORKSPACE || ".data/workspace"),
  origins: [origin],
});
let auth,
  turns = 0;
ctx.runtime.on("event", (m) => {
  if (m.method === "turn/started") turns++;
});
try {
  await ctx.runtime.start();
  assert.equal(ctx.runtime.state, "ready", ctx.runtime.reason);
  assert.equal(
    ctx.runtime.home,
    resolve(process.env.NEWBOT_CODEX_HOME || join(directory, "codex")),
  );
  const anonymous = await ctx.app.inject({
    method: "GET",
    url: "/api/config",
    headers,
  });
  assert.equal(anonymous.statusCode, 401);
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers,
    payload: { password },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers["set-cookie"].split(";")[0];
  auth = { ...headers, cookie };
  const capabilities = await ctx.app.inject({
    method: "GET",
    url: "/api/runtime/capabilities",
    headers: auth,
  });
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().status, "ready");
  const config = await ctx.app.inject({
    method: "GET",
    url: "/api/config",
    headers: auth,
  });
  assert.equal(config.statusCode, 200);
  const manifest = JSON.parse(
    await readFile(join(ctx.runtime.home, "newbot-migration.json"), "utf8"),
  );
  let readable = 0;
  for (const id of manifest.threadIds) {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/threads/" + id,
      headers: auth,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().id, id);
    readable++;
  }
  await ctx.app.inject({ method: "POST", url: "/api/logout", headers: auth });
  auth = undefined;
  assert.equal(ctx.db.get("password"), passwordHash);
  assert.equal(
    ctx.db.raw.prepare("SELECT count(*) AS n FROM threads").get().n,
    counts.threads,
  );
  assert.equal(
    ctx.db.raw.prepare("SELECT count(*) AS n FROM runs").get().n,
    counts.runs,
  );
  assert.equal(turns, 0);
  assert.equal(await hash(hostConfig), hostBefore);
  const result = {
    runtime: "ready",
    bundle: "dist/server/index.js",
    runtimeHomeIsolated: true,
    passwordUnchanged: true,
    hostConfigUnchanged: true,
    anonymousStatus: anonymous.statusCode,
    loginStatus: login.statusCode,
    configurationStatus: config.statusCode,
    readableOriginalThreads: readable,
    webThreadRows: counts.threads,
    runRowsUnchanged: true,
    credentialReferencesResolved: ctx.runtime.credentialRefs.size,
    modelTurns: turns,
    publicListenerStarted: false,
  };
  await writeFile(
    ".issue/2026-11-09/evidence-04/isolated-app-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (auth)
    await ctx.app.inject({ method: "POST", url: "/api/logout", headers: auth });
  await ctx.app.close();
}
