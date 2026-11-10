import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export const envFile = resolve(
  process.env.NEWBOT_ENV_FILE || "deploy/production.env",
);
process.env.NEWBOT_ENV_FILE = envFile;
export const composeArgs = [
  "compose",
  "--env-file",
  envFile,
  "-f",
  "deploy/compose.production.yaml",
];
export async function command(exe, args, options = {}) {
  await new Promise((done, reject) => {
    const child = spawn(exe, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error(`${exe} failed (${code})`)),
    );
  });
}
export async function client() {
  const base = process.env.OPS_URL || "http://127.0.0.1:3100";
  const origin = process.env.PUBLIC_ORIGIN || base;
  const password =
    process.env.OPS_PASSWORD ||
    readFileSync(
      process.env.OPS_PASSWORD_FILE ||
        resolve(
          process.env.NEWBOT_DATA_DIR || "/srv/newbot/data",
          "initial-password",
        ),
      "utf8",
    ).trim();
  const response = await fetch(base + "/api/login", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Operational login failed");
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No session returned");
  async function api(path, body) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        cookie,
        origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(`Operational request failed (${response.status})`);
    return value;
  }
  return api;
}
