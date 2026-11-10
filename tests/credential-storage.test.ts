import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import {
  credentialVault,
  credentialBinding,
} from "../server/credential-vault.js";
import {
  credentialFixture,
  credentialTestSecret,
} from "./credential-fixture.js";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
const secret = Buffer.from("vault-synthetic-key-never-public");
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "newbot-vault-")),
    cwd = join(directory, "workspace");
  mkdirSync(cwd);
  const db = database(directory),
    vault = credentialVault(db, directory, cwd);
  const config: any = {
    model_providers: {
      custom: { base_url: "https://example.com/v1", wire_api: "responses" },
    },
    mcp_servers: { remote: { url: "https://mcp.example.com/mcp" } },
  };
  return {
    db,
    vault,
    config,
    directory,
    cwd,
    close() {
      vault.close();
      db.raw.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("vault encrypts at rest with a separate protected key and authenticates ciphertext and metadata", () => {
  const c = setup();
  try {
    const binding = credentialBinding("provider", "custom", c.config)!;
    const ref = c.vault.stage(
      "provider",
      "custom",
      binding.binding,
      "encrypted",
      secret,
    );
    c.config.model_providers.custom.env_key = ref;
    assert.equal(c.vault.nativeEnv(c.config)[ref], secret.toString());
    assert.ok(
      !JSON.stringify(
        c.db.raw.prepare("SELECT * FROM managed_credentials").all(),
      ).includes(secret.toString()),
    );
    const ciphertext = c.db.raw
      .prepare("SELECT ciphertext FROM managed_credentials WHERE ref=?")
      .get(ref) as { ciphertext: Uint8Array };
    assert.equal(Buffer.from(ciphertext.ciphertext).includes(secret), false);
    assert.equal(
      statSync(join(c.directory, "private-credentials.key")).mode & 0o777,
      0o600,
    );
    assert.ok(
      !JSON.stringify(c.vault.info("provider", "custom", c.config)).includes(
        secret.toString(),
      ),
    );
    c.db.raw
      .prepare("UPDATE managed_credentials SET binding=? WHERE ref=?")
      .run("changed", ref);
    assert.deepEqual(c.vault.nativeEnv(c.config), {});
  } finally {
    c.close();
  }
});
test("encrypted entries restore after restart, memory entries do not, and unknown refs never activate", () => {
  const c = setup();
  let second: ReturnType<typeof credentialVault> | undefined;
  try {
    const provider = credentialBinding("provider", "custom", c.config)!,
      mcp = credentialBinding("mcp", "remote", c.config)!;
    const ref = c.vault.stage(
        "provider",
        "custom",
        provider.binding,
        "encrypted",
        secret,
      ),
      ephemeral = c.vault.stage("mcp", "remote", mcp.binding, "memory", secret);
    assert.deepEqual(c.vault.nativeEnv(c.config), {});
    c.config.model_providers.custom.env_key = ref;
    c.config.mcp_servers.remote.bearer_token_env_var = ephemeral;
    c.vault.close();
    second = credentialVault(c.db, c.directory, c.cwd);
    assert.equal(second.nativeEnv(c.config)[ref], secret.toString());
    assert.equal(second.nativeEnv(c.config)[ephemeral], undefined);
    assert.equal(second.info("mcp", "remote", c.config).state, "missing");
  } finally {
    second?.close();
    c.close();
  }
});
test("receiver changes, cross-provider reuse and forwarding to stdio prevent native secret injection", () => {
  const c = setup();
  try {
    const ref = c.vault.stage(
      "provider",
      "custom",
      credentialBinding("provider", "custom", c.config)!.binding,
      "memory",
      secret,
    );
    c.config.model_providers.custom.env_key = ref;
    c.config.model_providers.other = { env_key: ref };
    assert.deepEqual(c.vault.nativeEnv(c.config), {});
    delete c.config.model_providers.other;
    c.config.mcp_servers.untrusted = { command: "node", env_vars: [ref] };
    assert.deepEqual(c.vault.nativeEnv(c.config), {});
    delete c.config.mcp_servers.untrusted;
    c.config.model_providers.custom.base_url = "https://changed.example.com/v1";
    assert.equal(
      c.vault.info("provider", "custom", c.config).state,
      "binding_changed",
    );
    assert.deepEqual(c.vault.nativeEnv(c.config), {});
  } finally {
    c.close();
  }
});
test("lost or symlinked master key locks encrypted credentials without silently regenerating a key", () => {
  const c = setup();
  let locked: ReturnType<typeof credentialVault> | undefined;
  try {
    const ref = c.vault.stage(
      "provider",
      "custom",
      credentialBinding("provider", "custom", c.config)!.binding,
      "encrypted",
      secret,
    );
    c.config.model_providers.custom.env_key = ref;
    c.vault.close();
    const file = join(c.directory, "private-credentials.key");
    unlinkSync(file);
    locked = credentialVault(c.db, c.directory, c.cwd);
    assert.equal(locked.encryptionAvailable, false);
    assert.equal(locked.info("provider", "custom", c.config).state, "locked");
    assert.deepEqual(locked.nativeEnv(c.config), {});
    locked.close();
    const elsewhere = join(c.directory, "other-key");
    writeFileSync(elsewhere, Buffer.alloc(32), { mode: 0o600 });
    symlinkSync(elsewhere, file);
    locked = credentialVault(c.db, c.directory, c.cwd);
    assert.equal(locked.encryptionAvailable, false);
    assert.equal(readFileSync(elsewhere).length, 32);
  } finally {
    locked?.close();
    c.close();
  }
});
test("vault writes fail closed inside the agent workspace and do not permit persistence", () => {
  const c = setup(),
    nested = credentialVault(c.db, c.cwd, c.cwd);
  try {
    assert.equal(nested.encryptionAvailable, false);
    assert.throws(() =>
      nested.stage("provider", "custom", "x", "encrypted", secret),
    );
  } finally {
    nested.close();
    c.close();
  }
});
async function body(
  c: Awaited<ReturnType<typeof credentialFixture>>,
  scope: "provider" | "mcp" = "provider",
  retention: "memory" | "encrypted" = "encrypted",
) {
  const settings = await c.service.settings(),
    targetId = scope === "provider" ? "secondary" : "secure";
  const info = (
    scope === "provider"
      ? settings.configuration!.providers
      : settings.configuration!.mcp
  ).find((v: { id: string; managedCredential?: any }) => v.id === targetId)!;
  return {
    requestId: randomUUID(),
    operation: "credential.save",
    scope,
    targetId,
    retention,
    expectedRevision: settings.configuration!.revision,
    expectedVaultVersion: info.managedCredential!.version,
  };
}
async function save(
  c: Awaited<ReturnType<typeof credentialFixture>>,
  input: Awaited<ReturnType<typeof body>>,
) {
  const created = await c.app.inject({
    method: "POST",
    url: "/api/credentials/requests",
    headers: c.headers,
    payload: input,
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().state, "waiting");
  return c.input(created.json().id);
}
test("Provider save writes only a reference, refreshes native credentials, and clear removes the value and reference", async () => {
  const c = await credentialFixture();
  try {
    const p = await body(c);
    const response = await save(c, p);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, "succeeded");
    assert.equal(response.json().applied, true);
    const settings = await c.service.settings(),
      row = settings.configuration!.providers.find(
        (v: any) => v.id === "secondary",
      )!;
    assert.equal(row.managedCredential!.state, "encrypted");
    assert.equal(row.managedCredential!.applied, true);
    const ref = c.codex.config.model_providers.secondary.env_key;
    assert.ok(ref.startsWith("NEWBOT_CREDENTIAL_KEY_"));
    for (const value of [
      JSON.stringify(c.codex.calls),
      JSON.stringify(settings),
      response.body,
      JSON.stringify(
        c.db.raw.prepare("SELECT * FROM managed_credentials").all(),
      ),
    ])
      assert.ok(!value.includes(credentialTestSecret));
    const clear = await c.app.inject({
      method: "POST",
      url: "/api/credentials/clear",
      headers: c.headers,
      payload: {
        scope: p.scope,
        targetId: p.targetId,
        expectedRevision: settings.configuration!.revision,
        expectedVaultVersion: row.managedCredential!.version,
        confirm: true,
      },
    });
    assert.equal(clear.statusCode, 200);
    assert.equal(clear.json().applied, true);
    assert.equal(c.codex.config.model_providers.secondary.env_key, undefined);
    assert.equal(c.vault.hasEntries, false);
    assert.ok(!c.codex.credentialRefs.has(ref));
  } finally {
    await c.close();
  }
});
test("HTTPS MCP bearer credentials use the native environment reference and remain absent from normal config", async () => {
  const c = await credentialFixture();
  try {
    c.codex.config.mcp_servers.secure = {
      url: new URL(c.endpoint).origin + "/mcp",
      enabled: true,
    };
    c.codex.version++;
    const response = await save(c, await body(c, "mcp", "memory"));
    assert.equal(response.json().state, "succeeded");
    const ref = c.codex.config.mcp_servers.secure.bearer_token_env_var;
    assert.ok(c.codex.credentialRefs.has(ref));
    assert.ok(!JSON.stringify(c.codex.config).includes(credentialTestSecret));
    const settings = await c.service.settings();
    assert.equal(
      settings.configuration!.mcp.find(
        (v: { id: string; managedCredential?: any }) => v.id === "secure",
      )!.managedCredential!.state,
      "memory",
    );
  } finally {
    await c.close();
  }
});
test("stale configuration or credential version cannot overwrite or clear an existing key", async () => {
  const c = await credentialFixture();
  try {
    const p = await body(c);
    await save(c, p);
    const created = await c.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: c.headers,
      payload: { ...p, requestId: randomUUID() },
    });
    assert.equal(created.json().state, "failed");
    const clear = await c.app.inject({
      method: "POST",
      url: "/api/credentials/clear",
      headers: c.headers,
      payload: {
        scope: p.scope,
        targetId: p.targetId,
        expectedRevision: p.expectedRevision,
        expectedVaultVersion: p.expectedVaultVersion,
        confirm: true,
      },
    });
    assert.notEqual(clear.statusCode, 200);
    assert.equal(c.vault.hasEntries, true);
  } finally {
    await c.close();
  }
});
test("a lost native write acknowledgment keeps the staged value until the authoritative outcome can be read", async () => {
  const c = await credentialFixture();
  try {
    c.codex.loseResponse = true;
    const response = await save(c, await body(c));
    assert.equal(response.json().state, "succeeded");
    assert.equal(response.json().applied, false);
    const settings = await c.service.settings(),
      info = settings.configuration!.providers.find(
        (v: any) => v.id === "secondary",
      )!.managedCredential!;
    assert.equal(info.state, "encrypted");
    assert.equal(info.applied, false);
    const apply = await c.app.inject({
      method: "POST",
      url: "/api/credentials/apply",
      headers: c.headers,
      payload: { expectedRevision: settings.configuration!.revision },
    });
    assert.equal(apply.statusCode, 200);
    assert.equal(
      (await c.service.settings()).configuration!.providers.find(
        (v: any) => v.id === "secondary",
      )!.managedCredential!.applied,
      true,
    );
  } finally {
    await c.close();
  }
});
test("restart failure reports saved but unapplied and preserves the encrypted credential", async () => {
  const c = await credentialFixture();
  try {
    c.codex.failRestart = true;
    const response = await save(c, await body(c));
    assert.equal(response.json().state, "succeeded");
    assert.equal(response.json().applied, false);
    assert.equal(c.vault.hasEntries, true);
    assert.equal(c.credentials.pending, 0);
  } finally {
    await c.close();
  }
});
test("Bridge restart reloads encrypted credentials but requires memory credentials to be entered again", async () => {
  for (const mode of ["memory", "encrypted"] as const) {
    const c = await credentialFixture();
    let next: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      await save(c, await body(c, "provider", mode));
      const config = structuredClone(c.codex.config);
      await c.app.close();
      const codex = new ProviderCodex(c.endpoint);
      codex.config = config;
      next = await createServer({
        providerRuntime: null,
        directory: c.directory,
        cwd: join(c.directory, "workspace"),
        codex,
        password: "private-fixture-password",
        origins: [c.origin],
        credentialCa: c.cert,
      });
      await next.app.ready();
      await codex.restart();
      const info = (
        await next.service.settings()
      ).configuration!.providers.find(
        (v: any) => v.id === "secondary",
      )!.managedCredential!;
      assert.equal(info.state, mode === "memory" ? "missing" : "encrypted");
      assert.equal(info.applied, mode === "encrypted");
    } finally {
      await next?.app.close();
      await c.close();
    }
  }
});

test("external binding changes terminate stale native authorization before a new turn", async () => {
  const c = await credentialFixture();
  try {
    await save(c, await body(c));
    c.codex.config.model_providers.secondary.base_url =
      "https://changed.example.com/v1";
    c.codex.version++;
    const calls = c.codex.calls.filter((v) => v.method === "turn/start").length;
    await assert.rejects(
      () => c.service.handle("turn/start", { text: "do not dispatch" }),
      /绑定已变化/,
    );
    assert.equal(c.codex.state, "offline");
    assert.equal(c.codex.credentialRefs.size, 0);
    assert.equal(
      c.codex.calls.filter((v) => v.method === "turn/start").length,
      calls,
    );
  } finally {
    await c.close();
  }
});
test("normal configuration APIs cannot retarget managed references or bypass the private clear path", async () => {
  const c = await credentialFixture();
  try {
    await save(c, await body(c));
    const settings = await c.service.settings();
    for (const patch of [
      { envKey: null },
      { baseUrl: "https://changed.example.com/v1" },
    ])
      await assert.rejects(
        () =>
          c.service.handle("provider/save", {
            id: "secondary",
            create: false,
            expectedRevision: settings.configuration!.revision,
            patch,
          }),
        /私密入口/,
      );
    assert.equal(c.codex.config.model_providers.secondary.base_url, c.endpoint);
    assert.equal(c.vault.hasEntries, true);
  } finally {
    await c.close();
  }
});
test("stdio and non-user-owned credential targets fail before any secret is staged", async () => {
  const c = await credentialFixture();
  try {
    const settings = await c.service.settings();
    const response = await c.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: c.headers,
      payload: {
        requestId: randomUUID(),
        operation: "credential.save",
        scope: "mcp",
        targetId: "local",
        retention: "encrypted",
        expectedRevision: settings.configuration!.revision,
        expectedVaultVersion: settings.configuration!.mcp.find(
          (v: any) => v.id === "local",
        )!.managedCredential!.version,
      },
    });
    assert.equal(response.json().state, "failed");
    assert.equal(c.vault.hasEntries, false);
    c.codex.noWritableLayer = true;
    const blocked = await c.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: c.headers,
      payload: await body(c),
    });
    assert.equal(blocked.json().state, "failed");
    assert.equal(c.vault.hasEntries, false);
  } finally {
    await c.close();
  }
});
test("v4 database upgrade preserves sessions and existing data while adding only encrypted credential storage", () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-v4-vault-"));
  try {
    const before = database(directory);
    before.set("password", "keep-hash");
    before.raw.exec("DROP TABLE managed_credentials; PRAGMA user_version=4");
    before.raw
      .prepare("INSERT INTO sessions VALUES('session',9999999999999)")
      .run();
    before.raw.close();
    const after = database(directory);
    assert.equal(after.get("password"), "keep-hash");
    assert.equal(
      (after.raw.prepare("PRAGMA user_version").get() as any).user_version,
      7,
    );
    assert.equal(
      (after.raw.prepare("SELECT COUNT(*) n FROM sessions").get() as any).n,
      1,
    );
    assert.equal(
      (
        after.raw
          .prepare("SELECT COUNT(*) n FROM managed_credentials")
          .get() as any
      ).n,
      0,
    );
    after.raw.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("master key removal during a running service locks reads and new encrypted writes", () => {
  const c = setup();
  try {
    const ref = c.vault.stage(
      "provider",
      "custom",
      credentialBinding("provider", "custom", c.config)!.binding,
      "encrypted",
      secret,
    );
    c.config.model_providers.custom.env_key = ref;
    unlinkSync(join(c.directory, "private-credentials.key"));
    assert.equal(c.vault.encryptionAvailable, false);
    assert.equal(c.vault.info("provider", "custom", c.config).state, "locked");
    assert.deepEqual(c.vault.nativeEnv(c.config), {});
    assert.throws(
      () => c.vault.stage("provider", "custom", "x", "encrypted", secret),
      /已锁定/,
    );
  } finally {
    c.close();
  }
});
