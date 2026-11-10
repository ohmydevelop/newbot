// Local development instance handoff only. Never starts or changes a public tunnel.
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  chmod,
  copyFile,
  rename,
} from "node:fs/promises";
import { constants, existsSync, openSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { spawn } from "node:child_process";
const root = process.cwd(),
  directory = resolve(process.env.DATA_DIR || ".data"),
  port = 3100,
  local = `http://127.0.0.1:${port}`;
const entry = resolve("dist/server/index.js"),
  pidFile = join(directory, "newbot-test.pid");
const result = {
  at: new Date().toISOString(),
  mode: "provider-memory",
  localOrigin: local,
  modelTurnsCreated: 0,
};
let stage = "preflight",
  cookie;
const request = (url, options = {}) =>
  fetch(local + url, {
    signal: AbortSignal.timeout(20000),
    redirect: "error",
    ...options,
  });
const origins = (process.env.PUBLIC_ORIGIN || local)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const oldOrigin = origins[0];
const password =
  process.env.ADMIN_PASSWORD ||
  (await readFile(join(directory, "initial-password"), "utf8")).trim();
const pid = JSON.parse(await readFile(pidFile, "utf8"));
assert.equal(pid.entry, entry);
assert.equal(
  await readFile(`/proc/${pid.pid}/comm`, "utf8").then((v) => v.trim()),
  "node-MainThread",
);
assert.ok(
  (await readFile(`/proc/${pid.pid}/cmdline`, "utf8"))
    .split("\0")
    .includes(entry),
);
const hostConfig = join(homedir(), ".codex", "config.toml");
const digest = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const hostBefore = await digest(hostConfig);
const db = new DatabaseSync(join(directory, "minimal-agent.sqlite"), {
  readOnly: true,
});
const passwordBefore = db
  .prepare("SELECT value FROM metadata WHERE key='password'")
  .get().value;
const [salt, encoded] = passwordBefore.split(":");
assert.ok(
  timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(encoded, "hex")),
  "Existing login must match before any maintenance",
);
const counts = {
  threads: db.prepare("SELECT count(*) AS n FROM threads").get().n,
  runs: db.prepare("SELECT count(*) AS n FROM runs").get().n,
};
try {
  const login = await request("/api/login", {
    method: "POST",
    headers: { Origin: oldOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  stage = "idle maintenance";
  const idle = await request("/api/agent/action", {
    method: "POST",
    headers: {
      Origin: oldOrigin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "bridge/maintenance", enabled: true }),
  });
  assert.equal(
    idle.status,
    200,
    "Busy instance must finish its tasks before restarting",
  );
  stage = "backup";
  const backupDir = join(
    directory,
    "restart-backups",
    "memory-service-" + Date.now(),
  );
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await backup(db, join(backupDir, "minimal-agent.sqlite"));
  await chmod(join(backupDir, "minimal-agent.sqlite"), 0o600);
  if (existsSync(join(directory, "private-credentials.key"))) {
    await copyFile(
      join(directory, "private-credentials.key"),
      join(backupDir, "private-credentials.key"),
      constants.COPYFILE_EXCL,
    );
    await chmod(join(backupDir, "private-credentials.key"), 0o600);
  }
  // Retain the existing shared origin while making the development listener usable locally.
  if (!origins.includes(local)) {
    await copyFile(
      ".env",
      join(backupDir, "environment"),
      constants.COPYFILE_EXCL,
    );
    await chmod(join(backupDir, "environment"), 0o600);
    origins.push(local);
    const text = await readFile(".env", "utf8");
    const changed = /^PUBLIC_ORIGIN=/m.test(text)
      ? text.replace(
          /^PUBLIC_ORIGIN=.*$/m,
          "PUBLIC_ORIGIN=" + origins.join(","),
        )
      : text + "\nPUBLIC_ORIGIN=" + origins.join(",") + "\n";
    const temporary = ".env.memory-" + process.pid;
    await writeFile(temporary, changed, { mode: 0o600, flag: "wx" });
    await rename(temporary, ".env");
  }
  stage = "stop old instance";
  process.kill(pid.pid, "SIGTERM");
  const stopped = Date.now() + 15000;
  while (existsSync(`/proc/${pid.pid}`)) {
    if (Date.now() > stopped) throw Error("Old test instance did not stop");
    await new Promise((r) => setTimeout(r, 100));
  }
  stage = "start memory instance";
  const logfile = openSync(
    join(directory, "newbot-test.log"),
    constants.O_CREAT |
      constants.O_APPEND |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", entry], {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_ORIGIN: origins.join(","),
      NEWBOT_IMPORT_PROVIDER_CONFIG_ONCE: "true",
    },
    stdio: ["ignore", logfile, logfile],
  });
  child.unref();
  await writeFile(pidFile, JSON.stringify({ pid: child.pid, entry }), {
    mode: 0o600,
  });
  result.servicePid = child.pid;
  const until = Date.now() + 30000;
  while (true) {
    let ready = false;
    try {
      ready = (await request("/api/ready")).status === 200;
    } catch {}
    if (ready) break;
    if (Date.now() > until)
      throw Error("New test instance did not become ready");
    await new Promise((r) => setTimeout(r, 200));
  }
  stage = "verify migrated instance";
  const headers = { Origin: local, Cookie: cookie };
  const caps = await request("/api/runtime/capabilities", { headers }).then(
    (r) => r.json(),
  );
  assert.equal(caps.status, "ready");
  assert.equal(caps.capabilities.providerManagement.storage, "memory");
  const config = await request("/api/runtime/config", { headers }).then((r) =>
    r.json(),
  );
  assert.equal(config.storage, "memory");
  const manifest = JSON.parse(
    await readFile(
      join(
        process.env.NEWBOT_CODEX_HOME || join(directory, "codex"),
        "newbot-migration.json",
      ),
      "utf8",
    ),
  );
  let readable = 0;
  for (const id of manifest.threadIds) {
    const response = await request("/api/threads/" + id, { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, id);
    readable++;
  }
  const actual = new DatabaseSync(join(directory, "minimal-agent.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    actual.prepare("SELECT value FROM metadata WHERE key='password'").get()
      .value,
    passwordBefore,
  );
  assert.equal(
    actual.prepare("SELECT count(*) AS n FROM threads").get().n,
    counts.threads,
  );
  assert.equal(
    actual.prepare("SELECT count(*) AS n FROM runs").get().n,
    counts.runs,
  );
  actual.close();
  const activeConfig = await readFile(
    join(
      process.env.NEWBOT_CODEX_HOME || join(directory, "codex"),
      "config.toml",
    ),
    "utf8",
  );
  assert.ok(
    !/\[model_providers|^model_provider\s*=|^model\s*=/m.test(activeConfig),
  );
  const index = await request("/").then((r) => r.text());
  const asset = (await readFile("dist/web/index.html", "utf8")).match(
    /src="([^"]+\.js)"/,
  )[1];
  assert.ok(index.includes(asset));
  assert.equal(await digest(hostConfig), hostBefore);
  Object.assign(result, {
    latestWebEntry: true,
    runtimeReady: true,
    codexVersion: caps.version,
    providerCountInMemory: config.configuration.providers.length,
    providerConfigAbsentFromActiveFile: true,
    readableOriginalThreads: readable,
    webThreadRows: counts.threads,
    runRowsUnchanged: true,
    passwordUnchanged: true,
    personalConfigUnchangedDuringHandoff: true,
    localOriginAllowed: true,
    publicTunnelChanged: false,
  });
  console.log(JSON.stringify(result));
  await mkdir(".issue/2026-11-10/evidence", { recursive: true });
  await writeFile(
    ".issue/2026-11-10/evidence/service-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
} catch {
  throw Error(
    "Local test service handoff stopped at " +
      stage +
      "; inspect private operational logs",
  );
} finally {
  db.close();
  if (cookie)
    await request("/api/logout", {
      method: "POST",
      headers: {
        Origin: origins.includes(local) ? local : oldOrigin,
        Cookie: cookie,
      },
    }).catch(() => {});
}
