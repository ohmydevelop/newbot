// Run from repository root; restic must already be initialized with external encrypted storage.
import { statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { command, composeArgs, client, envFile } from "./ops-common.mjs";
const data = resolve(process.env.NEWBOT_DATA_DIR || "/srv/newbot/data");
if (basename(data) !== "data" || data === "/data")
  throw new Error("Use the dedicated host /.../data directory");
if (!process.env.RESTIC_REPOSITORY || !process.env.RESTIC_PASSWORD_FILE)
  throw new Error("Configure RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE");
if ((statSync(envFile).mode & 0o077) !== 0)
  throw new Error("Production env file must have mode 0600");
const api = await client();
await api("/api/agent/action", { action: "bridge/maintenance", enabled: true });
let stopped = false;
try {
  await command("docker", [...composeArgs, "stop", "minimal-agent"]);
  stopped = true;
  await command("restic", ["backup", "--tag", "newbot", data, envFile]);
  await command("restic", [
    "forget",
    "--tag",
    "newbot",
    "--group-by",
    "host,paths",
    "--keep-daily",
    "7",
    "--keep-weekly",
    "4",
    "--prune",
  ]);
} finally {
  if (stopped)
    await command("docker", [...composeArgs, "start", "minimal-agent"]);
  else
    await api("/api/agent/action", {
      action: "bridge/maintenance",
      enabled: false,
    });
}
