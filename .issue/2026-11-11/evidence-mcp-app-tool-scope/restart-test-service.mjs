// Update only the existing local test instance after acquiring its idle maintenance lock.
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  chmod,
  cp,
  readlink,
  stat,
} from "node:fs/promises";
import { existsSync, openSync, closeSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { spawn } from "node:child_process";
const root = process.cwd(),
  directory = resolve(process.env.DATA_DIR || ".data"),
  entry = resolve("dist/server/index.js"),
  origin = "http://127.0.0.1:3100";
const output = resolve(".issue/2026-11-11/evidence-mcp-app-tool-scope/service"),
  pidFile = join(directory, "newbot-test.pid"),
  databasePath = join(directory, "minimal-agent.sqlite");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const optionalDigest = async (path) =>
  existsSync(path) ? digest(await readFile(path)) : null;
const personal = join(homedir(), ".codex", "config.toml"),
  instance = resolve(process.env.NEWBOT_CODEX_HOME || join(directory, "codex")),
  key = join(directory, "private-credentials.key");
const beforeFiles = await Promise.all(
  [personal, join(instance, "config.toml"), key].map(optionalDigest),
);
let current = JSON.parse(await readFile(pidFile, "utf8")),
  cookie,
  stage = "preflight",
  locked = false,
  stopped = false,
  backupDir;
const originalPid = current.pid;
const request = async (path, body) => {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie || "",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000),
    redirect: "error",
  });
  assert.equal(
    response.status,
    200,
    `${stage}: ${path} returned ${response.status}`,
  );
  return response.json();
};
const control = (action, fields = {}) =>
  request("/api/agent/action", { action, ...fields });
const summary = (db) =>
  Object.fromEntries(
    ["threads", "runs", "attachments"].map((table) => [
      table,
      db.prepare(`SELECT count(*) n FROM ${table}`).get().n,
    ]),
  );
const privateConfigurationShape = (db) => Object.fromEntries(
  ["plugin_connection_settings", "private_field_sets", "extension_packages"].map(table =>
    [table, digest(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))]),
);
const historyShape = (t) =>
  digest(
    JSON.stringify({
      id: t.id,
      turns: t.turns.map((v) => ({
        id: v.id,
        items: v.items.map((i) => [i.id, i.type]),
      })),
    }),
  );
const pause = () => new Promise((r) => setTimeout(r, 150));
async function verifyProcess() {
  assert.equal(current.entry, entry);
  assert.equal(await readlink(`/proc/${current.pid}/cwd`), root);
  assert.ok(
    (await readFile(`/proc/${current.pid}/cmdline`, "utf8"))
      .split("\0")
      .includes(entry),
  );
}
async function stop() {
  await verifyProcess();
  process.kill(current.pid, "SIGTERM");
  const until = Date.now() + 15000;
  while (existsSync(`/proc/${current.pid}`)) {
    if (
      /^State:\s+Z/m.test(
        await readFile(`/proc/${current.pid}/status`, "utf8").catch(
          () => "State: Z",
        ),
      )
    )
      break;
    if (Date.now() > until) throw Error("Test service did not stop cleanly");
    await pause();
  }
  stopped = true;
}
async function start() {
  const fd = openSync(join(directory, "newbot-test.log"), "a", 0o600);
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", entry], {
    cwd: root,
    detached: true,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "3100" },
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  closeSync(fd);
  current = { pid: child.pid, entry };
  await writeFile(pidFile, JSON.stringify(current), { mode: 0o600 });
  const until = Date.now() + 30000;
  while (true) {
    let ready = false;
    try {
      ready =
        (
          await fetch(origin + "/api/ready", {
            signal: AbortSignal.timeout(2000),
          })
        ).status === 200;
    } catch {}
    if (ready) break;
    if (Date.now() > until)
      throw Error("Updated test service did not become ready");
    await pause();
  }
  stopped = false;
  locked = false;
}
async function build() {
  const fd = openSync(join(directory, "issue06-build.log"), "w", 0o600);
  const child = spawn("npm", ["run", "build"], {
    cwd: root,
    stdio: ["ignore", fd, fd],
  });
  const code = await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  closeSync(fd);
  assert.equal(code, 0, "Build failed; see private build log");
}
try {
  await verifyProcess();
  const password =
    process.env.ADMIN_PASSWORD ||
    (await readFile(join(directory, "initial-password"), "utf8")).trim();
  const login = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const original = new DatabaseSync(databasePath, { readOnly: true });
  let counts = summary(original);
  const passwordHash = original
    .prepare("SELECT value FROM metadata WHERE key='password'")
    .get().value;
  let providers = await request("/api/runtime/config");
  assert.equal(providers.storage, "sqlite");
  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify({
        ready: true,
        pid: current.pid,
        schema: original.prepare("PRAGMA user_version").get().user_version,
        counts,
      }),
    );
    original.close();
    process.exit(0);
  }
  stage = "idle maintenance";
  await control("bridge/maintenance", { enabled: true });
  locked = true;
  counts = summary(original);
  const privateShape = privateConfigurationShape(original);
  providers = await request("/api/runtime/config");
  const histories = new Map();
  const rows = original
    .prepare(
      "SELECT id FROM threads WHERE archived=0 ORDER BY updated DESC LIMIT 3",
    )
    .all();
  for (const { id } of rows)
    histories.set(
      id,
      historyShape(await request("/api/threads/" + encodeURIComponent(id))),
    );
  stage = "backup";
  backupDir = join(directory, "restart-backups", "mcp-app-tool-scope-" + Date.now());
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(backupDir, "verification.json"),
    JSON.stringify({
      oldPid: originalPid,
      counts,
      histories: [...histories],
      protectedDigests: beforeFiles,
      providerView: providers.configuration,
    }),
    { mode: 0o600 },
  );
  await backup(original, join(backupDir, "minimal-agent.sqlite"));
  await chmod(join(backupDir, "minimal-agent.sqlite"), 0o600);
  original.close();
  for (const [source, name] of [
    [key, "private-credentials.key"],
    [join(instance, "config.toml"), "config.toml"],
    [resolve(".env"), "service.env"],
  ])
    if (existsSync(source)) {
      await cp(source, join(backupDir, name));
      await chmod(join(backupDir, name), 0o600);
    }
  await cp(resolve("dist"), join(backupDir, "dist"), { recursive: true });
  stage = "stop and build";
  await stop();
  // Current build already passed typecheck and bundling.
  stage = "start";
  await start();
  stage = "verify";
  const capabilities = await request("/api/runtime/capabilities");
  assert.equal(capabilities.version, "codex-cli 0.165.0");
  assert.equal(capabilities.capabilities.mcpAppHost.version, 2);
  assert.equal(capabilities.capabilities.mcpAppHost.toolScope, "same-server-app-visible");
  assert.equal(capabilities.capabilities.imports.available, true);
  assert.equal(capabilities.capabilities.media.authenticatedSnapshots, true);
  assert.equal(
    capabilities.capabilities.presentation.newThreads,
    "newbot:ui/v2",
  );
  assert.equal(capabilities.capabilities.experts.available, true);
  assert.equal(
    capabilities.capabilities.sessionSettings.nextTurnSettings,
    true,
  );
  assert.equal(
    capabilities.capabilities.sessionSettings.persistentInputReferences,
    true,
  );
  assert.equal(capabilities.capabilities.plugins.configuration.descriptor, "mcpb-manifest");
  assert.deepEqual(capabilities.capabilities.plugins.configuration.manifestVersions, ["0.3"]);
  assert.equal(capabilities.capabilities.plugins.configuration.certificateInspection, true);
  const afterProviders = await request("/api/runtime/config");
  const providerShape = (configuration) => ({
    defaults: configuration.defaults,
    providers: configuration.providers.map(({ privateFields, ...p }) => ({
      ...p,
      customModels: p.customModels || [],
    })),
    mcp: configuration.mcp.map(
      ({ privateFields, name, definition, ...m }) => m,
    ),
  });
  assert.deepEqual(
    providerShape(afterProviders.configuration),
    providerShape(providers.configuration),
  );
  for (const [id, shape] of histories)
    assert.equal(
      historyShape(await request("/api/threads/" + encodeURIComponent(id))),
      shape,
    );
  const db = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(summary(db), counts);
  assert.deepEqual(privateConfigurationShape(db), privateShape);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 14);
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(
    db.prepare("SELECT value FROM metadata WHERE key='password'").get().value,
    passwordHash,
  );
  db.close();
  assert.deepEqual(
    await Promise.all(
      [personal, join(instance, "config.toml"), key].map(optionalDigest),
    ),
    beforeFiles,
  );
  const diskHtml = await readFile(resolve("dist/web/index.html"), "utf8"),
    localHtml = await (await fetch(origin)).text();
  assert.equal(localHtml, diskHtml);
  const asset = /src="([^"]+\.js)"/.exec(diskHtml)?.[1];
  assert.ok(asset);
  assert.equal((await fetch(origin + asset)).status, 200);
  const result = {
    at: new Date().toISOString(),
    oldPid: originalPid,
    pid: current.pid,
    schema: 14,
    counts,
    passwordUnchanged: true,
    credentialsUnchanged: true,
    pluginSettingsAndPrivateFieldsUnchanged: true,
    personalConfigUnchanged: true,
    instanceConfigUnchanged: true,
    providersUnchanged: true,
    historiesVerified: histories.size,
    modelTurnsCreated: 0,
    asset,
    backup: backupDir,
  };
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "local-update.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  const sharePath = join(directory, "public-share.json");
  if (existsSync(sharePath)) {
    const share = JSON.parse(await readFile(sharePath, "utf8"));
    await writeFile(
      sharePath,
      JSON.stringify(
        {
          ...share,
          servicePid: current.pid,
          verifiedAt: result.at,
          schema: 14,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Do not restore a database over an active process or silently change configuration.
  if (stopped && backupDir && stage === "stop and build") {
    await cp(join(backupDir, "dist"), resolve("dist"), { recursive: true });
    await start().catch(() => {});
  }
  if (locked && !stopped)
    await control("bridge/maintenance", { enabled: false }).catch(() => {});
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ stage, error: String(error), backup: backupDir }, null, 2),
  );
  throw error;
}
