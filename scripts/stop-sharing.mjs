import { readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
let stopped = 0;
for (const name of ["web", "apps"]) {
  const file = `.data/cloudflare-${name}.pid`;
  try {
    const pid = Number(readFileSync(`${root}/${file}`, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 1) continue;
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    if (
      readlinkSync(`/proc/${pid}/cwd`) !== root ||
      !args[0].endsWith("/cloudflared") ||
      args[args.indexOf("--pidfile") + 1] !== file
    )
      continue;
    process.kill(pid, "SIGTERM");
    stopped++;
  } catch (e) {
    if (!["ENOENT", "ESRCH"].includes(e.code)) throw e;
  }
}
try {
  const path = `${root}/.data/public-share.json`;
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.status = "stopped";
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
} catch {}
console.log(`已停止 ${stopped} 个本项目的分享隧道；本地工作台继续运行。`);
