// Local test-instance upgrade and restart proof. No tunnel or model inference.
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
  chmod,
  readlink,
} from "node:fs/promises";
import { constants, existsSync, openSync, closeSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { execFileSync, spawn } from "node:child_process";
import { database } from "../server/db.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
import { initialProviderRuntime } from "../server/provider-source.ts";
import {
  providerState,
  providerStateContent,
} from "../server/provider-state.ts";

const directory = resolve(process.env.DATA_DIR || ".data"),
  root = process.cwd();
const entry = resolve("dist/server/index.js"),
  pidFile = join(directory, "newbot-test.pid");
const origin = "http://127.0.0.1:3100",
  headers = { Origin: origin, "Content-Type": "application/json" };
const output = resolve(".issue/2026-11-10/evidence-sqlite");
const hash = (v) => createHash("sha256").update(v).digest("hex");
const host = join(homedir(), ".codex", "config.toml"),
  hostBefore = hash(await readFile(host));
let current = JSON.parse(await readFile(pidFile, "utf8")),
  cookie,
  stage = "preflight",
  draining = false;
const request = async (path, body) => {
  const r = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000),
    redirect: "error",
  });
  assert.equal(
    r.status,
    200,
    `Local service request failed at ${stage} (${r.status})`,
  );
  return r.json();
};
const control = (action, fields = {}) =>
  request("/api/agent/action", { action, ...fields });
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
    if (Date.now() > until) throw Error("Local service did not stop");
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function start() {
  const fd = openSync(
    join(directory, "newbot-test.log"),
    constants.O_CREAT |
      constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  const env = { ...process.env, HOST: "127.0.0.1", PORT: "3100" };
  delete env.NEWBOT_IMPORT_PROVIDER_CONFIG_ONCE;
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", entry], {
    cwd: root,
    detached: true,
    env,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  closeSync(fd);
  current = { pid: child.pid, entry };
  await writeFile(pidFile, JSON.stringify(current), { mode: 0o600 });
  draining = false;
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
    if (ready) return;
    if (Date.now() > until)
      throw Error("Local SQLite service did not become ready");
    await new Promise((r) => setTimeout(r, 150));
  }
}
const historyShape = (t) =>
  hash(
    JSON.stringify({
      id: t.id,
      turns: t.turns.map((turn) => ({
        id: turn.id,
        items: turn.items.map((item) => ({ id: item.id, type: item.type })),
      })),
    }),
  );
const original = new DatabaseSync(join(directory, "newbot.sqlite"), {
  readOnly: true,
});
try {
  await verifyProcess();
  const password =
    process.env.ADMIN_PASSWORD ||
    (await readFile(join(directory, "initial-password"), "utf8")).trim();
  const login = await fetch(origin + "/api/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const counts = {
    threads: original.prepare("SELECT count(*) n FROM threads").get().n,
    runs: original.prepare("SELECT count(*) n FROM runs").get().n,
  };
  const passwordBefore = original
    .prepare("SELECT value FROM metadata WHERE key='password'")
    .get().value;
  const keyFile = join(directory, "private-credentials.key"),
    keyBefore = hash(await readFile(keyFile));
  const before = await request("/api/runtime/config");
  const live = before.configuration;
  let seed;
  if (before.storage === "memory") {
    stage = "capture verified live memory configuration";
    const migration = JSON.parse(
      original
        .prepare(
          "SELECT value FROM metadata WHERE key='provider-memory-import-v1'",
        )
        .get().value,
    );
    const service = JSON.parse(
      await readFile(".issue/2026-11-10/evidence/service-result.json", "utf8"),
    );
    assert.equal(
      service.servicePid,
      current.pid,
      "Cannot infer a different volatile instance's configuration",
    );
    const changes = original
      .prepare(
        "SELECT action FROM audit WHERE at>=? AND (action LIKE 'provider/%' OR action LIKE 'credentials/%' OR action='runtime/config')",
      )
      .all(Date.parse(service.at));
    assert.equal(
      changes.length,
      0,
      "Volatile directory changed since its verified import; refuse to guess endpoint parameters",
    );
    let archive;
    for (const folder of await readdir(join(directory, "restart-backups"))) {
      if (!/^provider-memory-\d+$/.test(folder)) continue;
      const path = join(directory, "restart-backups", folder);
      if (
        hash(await readFile(join(path, "config.toml"))) ===
        migration.sourceDigest
      )
        archive = path;
    }
    assert.ok(archive, "No verified private migration source");
    seed = JSON.parse(
      execFileSync(
        "python3",
        [
          "-I",
          "-c",
          String.raw`import json,pathlib,sys,tomllib
p=pathlib.Path(sys.argv[1]); d=tomllib.loads((p/'config.toml').read_text())
s={k:d[k] for k in ('model','model_provider','model_reasoning_effort','model_providers') if k in d}
s['profiles']={k:v for k,v in d.get('profiles',{}).items() if k.startswith('newbot_gateway_')}
for f in p.glob('newbot_gateway_*.config.toml'):
 v=tomllib.loads(f.read_text()); i=f.name.removesuffix('.config.toml')
 if v.get('model'): s['profiles'][i]={'model_provider':v['model_provider'],'model':v['model']}
print(json.dumps(s))`,
          archive,
        ],
        {
          encoding: "utf8",
          maxBuffer: 262144,
          env: { PATH: process.env.PATH, PYTHONNOUSERSITE: "1" },
        },
      ),
    );
    assert.deepEqual(
      Object.keys(seed.model_providers).sort(),
      live.providers
        .filter((p) => !p.missing)
        .map((p) => p.id)
        .sort(),
    );
    for (const p of live.providers) {
      const def = seed.model_providers[p.id];
      assert.equal(def.name, p.name);
      assert.equal(new URL(def.base_url).origin, p.endpointOrigin);
    }
    const catalog = await control("gateway/catalog");
    for (const g of catalog)
      if (seed.profiles[`newbot_gateway_${g.id}`] && g.defaultModel)
        seed.profiles[`newbot_gateway_${g.id}`].model = g.defaultModel;
    Object.assign(seed, {
      model_provider: live.defaults.provider,
      model: live.defaults.model,
      model_reasoning_effort: live.defaults.effort,
    });
    providerStateContent(new ProviderRuntime(seed).snapshot().values);
  } else assert.equal(before.storage, "sqlite");
  stage = "idle maintenance and backup";
  await control("bridge/maintenance", { enabled: true });
  draining = true;
  const backupDir = join(
    directory,
    "restart-backups",
    "sqlite-service-" + Date.now(),
  );
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await backup(original, join(backupDir, "newbot.sqlite"));
  await chmod(join(backupDir, "newbot.sqlite"), 0o600);
  await copyFile(
    keyFile,
    join(backupDir, "private-credentials.key"),
    constants.COPYFILE_EXCL,
  );
  await chmod(join(backupDir, "private-credentials.key"), 0o600);
  const home = resolve(
    process.env.NEWBOT_CODEX_HOME || join(directory, "codex"),
  );
  const manifest = JSON.parse(
    await readFile(join(home, "newbot-migration.json"), "utf8"),
  );
  const histories = new Map();
  for (const id of manifest.threadIds)
    histories.set(id, historyShape(await request("/api/threads/" + id)));
  stage = "commit before stopping volatile instance";
  const db = database(directory);
  let durable;
  try {
    const runtime = await initialProviderRuntime(
      db,
      directory,
      resolve(process.env.AGENT_WORKSPACE || join(directory, "workspace")),
      seed ? new ProviderRuntime(seed) : undefined,
    );
    assert.equal(runtime.storage, "sqlite");
    durable = providerState(db).read();
    assert.ok(durable);
  } finally {
    db.raw.close();
  }
  for (let round = 1; round <= 2; round++) {
    stage = "restart and verify " + round;
    await stop();
    await start();
    const actual = await request("/api/runtime/config");
    assert.equal(actual.storage, "sqlite");
    assert.equal(actual.requiresResupplyAfterRestart, false);
    assert.equal(actual.configuration.providerSourceStatus, "restored");
    assert.deepEqual(
      actual.configuration.providers.map((p) => p.id).sort(),
      live.providers.map((p) => p.id).sort(),
    );
    assert.deepEqual(actual.configuration.defaults, live.defaults);
    for (const [id, digest] of histories)
      assert.equal(historyShape(await request("/api/threads/" + id)), digest);
    const check = new DatabaseSync(join(directory, "newbot.sqlite"), {
      readOnly: true,
    });
    try {
      assert.equal(check.prepare("PRAGMA user_version").get().user_version, 7);
      assert.deepEqual(providerState({ raw: check }).read(), durable);
      assert.equal(
        check.prepare("SELECT count(*) n FROM threads").get().n,
        counts.threads,
      );
      assert.equal(
        check.prepare("SELECT count(*) n FROM runs").get().n,
        counts.runs,
      );
      assert.equal(
        check.prepare("SELECT value FROM metadata WHERE key='password'").get()
          .value,
        passwordBefore,
      );
    } finally {
      check.close();
    }
    if (round === 1) {
      await control("bridge/maintenance", { enabled: true });
      draining = true;
    }
  }
  assert.equal(hash(await readFile(host)), hostBefore);
  assert.equal(hash(await readFile(keyFile)), keyBefore);
  const active = await readFile(join(home, "config.toml"), "utf8");
  assert.ok(!/^model_provider\s*=|^model\s*=|\[model_providers/m.test(active));
  const result = {
    at: new Date().toISOString(),
    storage: "sqlite",
    servicePid: current.pid,
    localOrigin: origin,
    restartsVerified: 2,
    providersRestored: live.providers.length,
    originalThreadsReadable: histories.size,
    webThreadRows: counts.threads,
    runRows: counts.runs,
    historyShapeUnchanged: true,
    passwordUnchanged: true,
    credentialMasterKeyUnchanged: true,
    personalConfigUnchangedDuringHandoff: true,
    providerConfigFileAbsent: true,
    modelTurnsCreated: 0,
    publicTunnelChanged: false,
  };
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "service-result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} catch {
  throw Error(
    "SQLite test-service handoff stopped at " +
      stage +
      "; private backups and operational logs retained",
  );
} finally {
  original.close();
  if (draining)
    await control("bridge/maintenance", { enabled: false }).catch(() => {});
  if (cookie) await request("/api/logout", {}).catch(() => {});
}
