import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const name = "newbot-ci-" + randomUUID();
const run = (args) => {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error("Docker command failed");
  return r.stdout.trim();
};
try {
  run([
    "run",
    "-d",
    "--name",
    name,
    "-p",
    "127.0.0.1::3100",
    "-e",
    "ADMIN_PASSWORD=ci-only-password-not-for-deployment",
    "-e",
    "PUBLIC_ORIGIN=http://localhost:3100",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,size=128m",
    "newbot:ci",
  ]);
  const mapping = run(["port", name, "3100/tcp"]);
  const port = mapping.split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/ready")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(ready, "Codex app-server never became ready");
  assert.equal((await fetch(base + "/api/config")).status, 401);
  console.log(
    "Non-root read-only container and native Codex readiness passed.",
  );
} finally {
  spawnSync("docker", ["rm", "-fv", name], { stdio: "ignore" });
}
