import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, open, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Codex } from "./codex.js";
import type { Store } from "./db.js";
import { gatewayProfiles } from "./gateway-profiles.js";
import {
  ProviderRuntime,
  providerRuntimeInput,
  providerRuntimeValues,
} from "./provider-runtime.js";
import { PublicError } from "./public-error.js";
import { providerReserved } from "./provider-policy.js";
import { providerState } from "./provider-state.js";

export async function fetchProviderSource() {
  try {
    const url = new URL(process.env.NEWBOT_RUNTIME_CONFIG_URL || "");
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error();
    const token = process.env.NEWBOT_RUNTIME_CONFIG_TOKEN;
    if (token && /[\r\n]/.test(token)) throw Error();
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok || !response.body) throw Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 131072) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const data = providerRuntimeInput.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    const allowed = new Set([
      "OPENAI_API_KEY",
      ...(process.env.PROVIDER_CREDENTIAL_ENV_ALLOWLIST || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ]);
    for (const p of data.providers)
      if (
        providerReserved.has(p.id) ||
        ["constructor", "prototype", "__proto__"].includes(p.id) ||
        (p.envKey &&
          (!allowed.has(p.envKey) ||
            [
              "ADMIN_PASSWORD",
              "HOME",
              "CODEX_HOME",
              "NODE_OPTIONS",
              "NEWBOT_RUNTIME_CONFIG_TOKEN",
            ].includes(p.envKey)))
      )
        throw Error();
    if (
      data.defaults?.provider !== undefined &&
      data.defaults.provider !== "openai" &&
      !data.providers.some((p) => p.id === data.defaults!.provider)
    )
      throw Error();
    return data;
  } catch {
    throw new PublicError("运行配置来源暂不可用或内容无效，已保留当前配置");
  }
}

/** Explicit one-time handoff: archive the old file and retain Provider parameters in SQLite. */
export async function importProviderConfigurationOnce(
  db: Store,
  directory: string,
  cwd: string,
) {
  const persisted = providerState(db);
  const saved = persisted.read();
  if (saved) {
    const runtime = new ProviderRuntime(saved.values, saved.revision).persist(
      persisted.writer(saved.revision),
    );
    runtime.sourceStatus = "restored";
    return runtime;
  }
  if (db.get("provider-memory-import-v1")) return new ProviderRuntime();
  const home = resolve(
    process.env.NEWBOT_CODEX_HOME || join(directory, "codex"),
  );
  const probe = new Codex(cwd, () => ({ CODEX_HOME: home }));
  try {
    await probe.start();
    if (probe.state !== "ready")
      throw new PublicError("旧实例配置暂不可读，未迁移");
    const before = await probe.call("config/read", {
      cwd,
      includeLayers: true,
    });
    const user = before.layers?.find(
      (l) => l.name.type === "user" && !l.name.profile && !l.disabledReason,
    );
    const native = user?.config as Record<string, any> | undefined;
    if (
      !native ||
      user?.name.type !== "user" ||
      resolve(user.name.file) !== join(home, "config.toml")
    )
      throw new PublicError("旧实例配置来源不可安全迁移");
    const seed: Record<string, any> = {
      model: native.model,
      model_provider: native.model_provider,
      model_reasoning_effort: native.model_reasoning_effort,
      model_providers: native.model_providers || {},
      profiles: Object.fromEntries(
        Object.entries(native.profiles || {}).filter(([id]) =>
          id.startsWith("newbot_gateway_"),
        ),
      ),
    };
    for (const def of Object.values(seed.model_providers) as Record<
      string,
      any
    >[]) {
      if (
        def.api_key ||
        def.experimental_bearer_token ||
        def.auth ||
        Object.keys(def.http_headers || {}).some(
          (k) => k.toLowerCase() === "authorization",
        )
      )
        throw new PublicError("旧网关存在内联认证，请先通过私密凭证入口迁移");
    }
    const profiles = gatewayProfiles(() => home);
    const ids = ["openai", ...Object.keys(seed.model_providers)];
    const owned: string[] = [];
    for (const id of ids) {
      const found = await profiles.read(id);
      if (found.model) {
        seed.profiles[`newbot_gateway_${id}`] = {
          model_provider: id,
          model: found.model,
        };
        owned.push(id);
      }
    }
    const snapshot = new ProviderRuntime(seed);
    snapshot.sourceStatus = "migrated";
    const backupDir = join(
      directory,
      "restart-backups",
      "provider-memory-" + Date.now(),
    );
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const source = await open(
      join(home, "config.toml"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let digest: string;
    try {
      const st = await source.stat();
      if (!st.isFile() || st.nlink !== 1 || st.size > 1048576) throw Error();
      digest = createHash("sha256")
        .update(await source.readFile())
        .digest("hex");
    } finally {
      await source.close();
    }
    await copyFile(
      join(home, "config.toml"),
      join(backupDir, "config.toml"),
      constants.COPYFILE_EXCL,
    );
    await chmod(join(backupDir, "config.toml"), 0o600);
    // Commit a recoverable definition before removing its last active file copy.
    snapshot.persist(persisted.writer(null), true);
    const result = await probe.call("config/batchWrite", {
      filePath: user.name.file,
      expectedVersion: user.version,
      reloadUserConfig: false,
      edits: [
        ...[
          "model_providers",
          "model_provider",
          "model",
          "model_reasoning_effort",
        ]
          .filter((key) => key in native)
          .map((keyPath) => ({
            keyPath,
            value: null,
            mergeStrategy: "replace" as const,
          })),
        ...Object.keys(seed.profiles)
          .filter((id) => id in (native.profiles || {}))
          .map((id) => ({
            keyPath: `profiles.${id}`,
            value: null,
            mergeStrategy: "replace" as const,
          })),
      ],
    });
    if (result.status !== "ok")
      throw new PublicError("旧配置迁移结果未确认，已保留备份");
    const after = await probe.call("config/read", { cwd, includeLayers: true });
    const actual = after.layers?.find(
      (l) => l.name.type === "user" && !l.name.profile,
    )?.config as Record<string, any>;
    if (actual?.model_providers || actual?.model_provider || actual?.model)
      throw new PublicError("旧 Provider 配置清理未确认，已保留备份");
    for (const id of owned) {
      const path = join(home, `newbot_gateway_${id}.config.toml`);
      if (existsSync(path))
        await rename(path, join(backupDir, `newbot_gateway_${id}.config.toml`));
    }
    db.set(
      "provider-memory-import-v1",
      JSON.stringify({
        at: Date.now(),
        sourceDigest: digest,
        providers: Object.keys(seed.model_providers).length,
      }),
    );
    return snapshot;
  } finally {
    await probe.stopAndWait();
  }
}

export async function initialProviderRuntime(
  db: Store,
  directory: string,
  cwd: string,
  seed?: ProviderRuntime,
) {
  const persisted = providerState(db);
  const saved = persisted.read();
  if (saved) {
    const runtime = new ProviderRuntime(saved.values, saved.revision).persist(
      persisted.writer(saved.revision),
    );
    runtime.sourceStatus = "restored";
    return runtime;
  }
  if (seed) return seed.persist(persisted.writer(null), true);
  if (process.env.NEWBOT_RUNTIME_CONFIG_URL) {
    let values;
    try {
      values = providerRuntimeValues(await fetchProviderSource());
    } catch {
      // No successful configuration yet: a later boot can retry the source.
      const runtime = new ProviderRuntime().persist(persisted.writer(null));
      runtime.sourceStatus = "unavailable";
      return runtime;
    }
    const runtime = new ProviderRuntime(values).persist(
      persisted.writer(null),
      true,
    );
    runtime.sourceStatus = "loaded";
    return runtime;
  }
  if (process.env.NEWBOT_IMPORT_PROVIDER_CONFIG_ONCE === "true") {
    const runtime = await importProviderConfigurationOnce(db, directory, cwd);
    return runtime.storage === "sqlite"
      ? runtime
      : runtime.persist(persisted.writer(null), true);
  }
  return new ProviderRuntime().persist(persisted.writer(null), true);
}
