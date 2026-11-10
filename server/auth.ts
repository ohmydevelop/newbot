import { PublicError } from "./public-error.js";
import { scrypt, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Store } from "./db.js";
const derive = promisify(scrypt);
function matches(value: string, encoded: string) {
  const [salt, digest] = encoded.split(":");
  return timingSafeEqual(
    scryptSync(value, salt, 64),
    Buffer.from(digest, "hex"),
  );
}
export function auth(
  store: Store,
  directory: string,
  password = process.env.ADMIN_PASSWORD,
) {
  const old = store.get("password");
  if (password && password.length < 12)
    throw new PublicError("ADMIN_PASSWORD 必须至少 12 个字符");
  if (!old || (password && !matches(password, old))) {
    const value = password || randomBytes(24).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    store.set(
      "password",
      `${salt}:${scryptSync(value, salt, 64).toString("hex")}`,
    );
    store.revokeSessions();
    const path = resolve(directory, "initial-password");
    if (!password) {
      writeFileSync(path, value + "\n", { mode: 0o600 });
      process.stdout.write(`首次登录密码保存在 ${path}（仅本机可读）。\n`);
    } else rmSync(path, { force: true });
  }
  const attempts = new Map<string, { count: number; until: number }>();
  let verifying = 0;
  return async (ip: string, value: string) => {
    const now = Date.now();
    for (const [key, a] of attempts) if (a.until <= now) attempts.delete(key);
    const current = attempts.get(ip);
    if (
      (current && current.count >= 8) ||
      verifying >= 4 ||
      (!current && attempts.size >= 4096)
    )
      throw new PublicError("尝试过于频繁，请稍后重试");
    // Reserve before awaiting: parallel requests cannot evade the limit.
    attempts.set(ip, {
      count: (current?.count || 0) + 1,
      until: current?.until || now + 900000,
    });
    verifying++;
    try {
      const [salt, digest] = store.get("password")!.split(":");
      const valid = timingSafeEqual(
        (await derive(value, salt, 64)) as Buffer,
        Buffer.from(digest, "hex"),
      );
      if (valid) attempts.delete(ip);
      return valid;
    } finally {
      verifying--;
    }
  };
}
