import { PublicError } from "./public-error.js";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { join, sep } from "node:path";
import type { Store } from "./db.js";
import { privateProviderReceiver, providerRecord } from "./provider-policy.js";
export const MANAGED_CREDENTIAL_PREFIX = "NEWBOT_CREDENTIAL_KEY_";
export type CredentialScope = "provider" | "mcp";
export type CredentialRetention = "memory" | "encrypted";
export const managedCredential = (v: unknown): v is string =>
  typeof v === "string" && /^NEWBOT_CREDENTIAL_KEY_[A-F0-9]{32}$/.test(v);
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export function credentialBinding(
  scope: CredentialScope,
  id: string,
  config: any,
) {
  const def = providerRecord(
    providerRecord(
      config[scope === "provider" ? "model_providers" : "mcp_servers"],
    )[id],
  );
  const authHeaders = (o: any) =>
    Object.keys(providerRecord(o)).some(
      (k) => k.toLowerCase() === "authorization",
    );
  if (authHeaders(def.http_headers) || authHeaders(def.env_http_headers))
    return null;
  if (
    scope === "provider" &&
    (!privateProviderReceiver(def) ||
      def.model_catalog_url ||
      def.api_key ||
      def.experimental_bearer_token ||
      def.auth)
  )
    return null;
  if (scope === "mcp") {
    try {
      const u = new URL(def.url);
      if (
        def.command ||
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        def.bearer_token
      )
        return null;
    } catch {
      return null;
    }
  }
  const ref = scope === "provider" ? def.env_key : def.bearer_token_env_var;
  const binding = digest(
    canonical({
      scope,
      id,
      endpoint: def[scope === "provider" ? "base_url" : "url"],
      wire: def.wire_api || null,
      account: !!def.requires_openai_auth,
      headers: def.http_headers || null,
      envHeaders: def.env_http_headers || null,
      auth: def.auth || null,
    }),
  );
  return {
    ref,
    binding,
    origin: new URL(def[scope === "provider" ? "base_url" : "url"]).origin,
  };
}
type Entry = {
  scope: CredentialScope;
  target: string;
  ref: string;
  binding: string;
  version: string;
  retention: CredentialRetention;
  updated: number;
  value?: Buffer;
  nonce?: Uint8Array;
  ciphertext?: Uint8Array;
  tag?: Uint8Array;
};
export function credentialVault(db: Store, directory: string, cwd: string) {
  const sql = db.raw,
    memory = new Map<string, Entry>();
  let master: Buffer | undefined,
    closed = false;
  const path = join(directory, "private-credentials.key");
  const persisted = () =>
    (sql.prepare("SELECT * FROM managed_credentials").all() as any[]).map(
      (row) => ({ ...row, retention: "encrypted" as const }),
    ) as Entry[];
  try {
    const data = realpathSync(directory),
      workspace = realpathSync(cwd);
    if (data === workspace || data.startsWith(workspace + sep))
      throw new Error();
    if (
      !existsSync(path) &&
      !persisted().length &&
      !sql.prepare("SELECT 1 FROM private_field_sets LIMIT 1").get() &&
      !sql.prepare("SELECT 1 FROM automation_mail_config LIMIT 1").get() &&
      !sql.prepare("SELECT 1 FROM automation_event_accounts LIMIT 1").get() &&
      !sql.prepare("SELECT 1 FROM automation_event_oauth LIMIT 1").get() &&
      !sql.prepare("SELECT 1 FROM automation_event_webhooks LIMIT 1").get()
    ) {
      const descriptor = openSync(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      const key = randomBytes(32);
      try {
        writeSync(descriptor, key);
        fsyncSync(descriptor);
      } finally {
        key.fill(0);
        closeSync(descriptor);
      }
      const parent = openSync(data, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid()) ||
        stat.size !== 32
      )
        throw new Error();
      master = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    master = undefined;
  }
  function masterAvailable() {
    if (!master || closed) return false;
    let fd: number | undefined, bytes: Buffer | undefined;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const st = fstatSync(fd);
      if (
        !st.isFile() ||
        st.nlink !== 1 ||
        st.mode & 0o077 ||
        (process.getuid && st.uid !== process.getuid()) ||
        st.size !== 32
      )
        return false;
      bytes = readFileSync(fd);
      return bytes.length === master.length && timingSafeEqual(bytes, master);
    } catch {
      return false;
    } finally {
      bytes?.fill(0);
      if (fd !== undefined) closeSync(fd);
    }
  }
  const entries = () => [...persisted(), ...memory.values()];
  const aad = (e: Entry) =>
    Buffer.from(
      JSON.stringify([1, e.scope, e.target, e.ref, e.binding, e.version]),
    );
  function decrypt(e: Entry) {
    if (e.value) return Buffer.from(e.value);
    if (!masterAvailable() || !e.nonce || !e.tag || !e.ciphertext)
      throw new PublicError("凭证存储已锁定");
    const cipher = createDecipheriv("aes-256-gcm", master!, e.nonce);
    cipher.setAAD(aad(e));
    cipher.setAuthTag(e.tag);
    return Buffer.concat([cipher.update(e.ciphertext), cipher.final()]);
  }
  function references(config: any, ref: string) {
    let count = 0;
    const walk = (v: any) => {
      if (v === ref) count++;
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(config);
    return count;
  }
  function current(scope: CredentialScope, id: string, config: any) {
    const def = providerRecord(
      providerRecord(
        config[scope === "provider" ? "model_providers" : "mcp_servers"],
      )[id],
    );
    const ref = def[scope === "provider" ? "env_key" : "bearer_token_env_var"];
    const entry = entries().find(
      (e) => e.ref === ref && e.scope === scope && e.target === id,
    );
    const binding = credentialBinding(scope, id, config);
    return {
      ref,
      entry,
      valid:
        !!entry &&
        binding?.binding === entry.binding &&
        references(config, entry.ref) === 1,
    };
  }
  function info(
    scope: CredentialScope,
    id: string,
    config: any,
    loaded: ReadonlySet<string> = new Set(),
  ) {
    const { ref, entry, valid } = current(scope, id, config);
    const held = entries().filter((e) => e.scope === scope && e.target === id);
    let state:
      | "none"
      | "missing"
      | "binding_changed"
      | "locked"
      | CredentialRetention = managedCredential(ref) ? "missing" : "none";
    if (entry) {
      if (!valid) state = "binding_changed";
      else {
        try {
          decrypt(entry).fill(0);
          state = entry.retention;
        } catch {
          state = "locked";
        }
      }
    }
    return {
      state,
      version:
        "cred1." +
        digest([
          ref || null,
          entry?.version || null,
          held.map((e) => e.version).sort(),
        ]),
      applied:
        valid &&
        (state === "memory" || state === "encrypted") &&
        loaded.has(ref),
      updatedAt: entry?.updated || null,
      stored: held.length > 0,
    };
  }
  function drop(ref: string) {
    memory.get(ref)?.value?.fill(0);
    memory.delete(ref);
    sql.prepare("DELETE FROM managed_credentials WHERE ref=?").run(ref);
  }
  return {
    restoreProviderReferences(config: any) {
      for (const [id, def] of Object.entries(config.model_providers || {}) as [
        string,
        any,
      ][]) {
        if (def.env_key) continue;
        const binding = credentialBinding("provider", id, config);
        if (!binding) continue;
        const matches = entries().filter(
          (e) =>
            e.scope === "provider" &&
            e.target === id &&
            e.binding === binding.binding,
        );
        if (matches.length !== 1) continue;
        try {
          decrypt(matches[0]).fill(0);
          def.env_key = matches[0].ref;
        } catch {
          /* A locked vault never supplies a reference. */
        }
      }
    },
    info,
    sealPrivate(value: Buffer, context: string) {
      if (!masterAvailable()) throw new PublicError("凭证存储已锁定");
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", master!, nonce);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(value), cipher.final()]);
      return JSON.stringify({
        nonce: nonce.toString("base64"),
        data: data.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      });
    },
    openPrivate(packet: string, context: string) {
      if (!masterAvailable()) throw new PublicError("凭证存储已锁定");
      try {
        const value = JSON.parse(packet),
          cipher = createDecipheriv(
            "aes-256-gcm",
            master!,
            Buffer.from(value.nonce, "base64"),
          );
        cipher.setAAD(Buffer.from(context));
        cipher.setAuthTag(Buffer.from(value.tag, "base64"));
        return Buffer.concat([
          cipher.update(Buffer.from(value.data, "base64")),
          cipher.final(),
        ]);
      } catch {
        throw new PublicError("凭证无法解密，请重新设置");
      }
    },
    get encryptionAvailable() {
      return masterAvailable();
    },
    get hasEntries() {
      return !closed && !!(memory.size || persisted().length);
    },
    stage(
      scope: CredentialScope,
      target: string,
      binding: string,
      retention: CredentialRetention,
      secret: Buffer,
    ) {
      if (
        closed ||
        !secret.length ||
        secret.length > 4096 ||
        entries().length >= 256
      )
        throw new PublicError("凭证存储暂不可用或已满");
      const e: Entry = {
        scope,
        target,
        binding,
        retention,
        ref:
          MANAGED_CREDENTIAL_PREFIX +
          randomBytes(16).toString("hex").toUpperCase(),
        version: randomUUID(),
        updated: Date.now(),
      };
      if (retention === "encrypted") {
        if (!masterAvailable()) throw new PublicError("加密凭证存储已锁定");
        const nonce = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", master!, nonce);
        cipher.setAAD(aad(e));
        const ciphertext = Buffer.concat([
            cipher.update(secret),
            cipher.final(),
          ]),
          tag = cipher.getAuthTag();
        sql
          .prepare(
            "INSERT INTO managed_credentials(scope,target,ref,binding,version,updated,nonce,ciphertext,tag) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            scope,
            target,
            e.ref,
            binding,
            e.version,
            e.updated,
            nonce,
            ciphertext,
            tag,
          );
      } else {
        e.value = Buffer.from(secret);
        memory.set(e.ref, e);
      }
      return e.ref;
    },
    drop,
    prune(scope: CredentialScope, target: string, keep?: string) {
      for (const e of entries())
        if (e.scope === scope && e.target === target && e.ref !== keep)
          drop(e.ref);
    },
    validRefs(config: any) {
      const allowed = new Set<string>();
      if (closed) return allowed;
      for (const e of entries())
        if (
          current(e.scope, e.target, config).valid &&
          current(e.scope, e.target, config).ref === e.ref
        ) {
          try {
            decrypt(e).fill(0);
            allowed.add(e.ref);
          } catch {
            /* Do not load a corrupt credential. */
          }
        }
      return allowed;
    },
    useCredential<T>(
      scope: CredentialScope,
      id: string,
      config: any,
      consume: (value: Buffer) => T,
    ): T {
      const entry = current(scope, id, config);
      if (closed || !entry.valid || !entry.entry)
        throw new PublicError("凭证绑定无效，请重新设置");
      const value = decrypt(entry.entry);
      try {
        return consume(value);
      } finally {
        value.fill(0);
      }
    },
    nativeEnv(config: any) {
      if (closed) return {};
      const env: NodeJS.ProcessEnv = {};
      for (const e of entries()) {
        if (
          !current(e.scope, e.target, config).valid ||
          current(e.scope, e.target, config).ref !== e.ref
        )
          continue;
        try {
          const secret = decrypt(e);
          try {
            env[e.ref] = secret.toString("ascii");
          } finally {
            secret.fill(0);
          }
        } catch {
          /* Locked and corrupt entries never supply a credential. */
        }
      }
      return env;
    },
    close() {
      closed = true;
      for (const e of memory.values()) e.value?.fill(0);
      memory.clear();
      master?.fill(0);
      master = undefined;
    },
  };
}
