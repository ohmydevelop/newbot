import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialFixture } from "./credential-fixture.js";
import { newGatewayId } from "../shared/gateways.js";
import { SkillsCodex } from "./skill-fixture.js";
import { createServer } from "../server/index.js";

test("gateway names need no native ID; a private create atomically stores metadata and an opaque credential reference", async () => {
  const c = await credentialFixture();
  const secret = "SYNTHETIC_GATEWAY_SECRET_02";
  try {
    const requestId = randomUUID(),
      id = newGatewayId(requestId);
    const config = await c.service.settings();
    const body = {
      operation: "provider.save",
      requestId,
      name: "Same display name",
      baseUrl: "https://gateway.example.test/v1",
      expectedRevision: config.configuration!.revision,
      retention: "encrypted",
    };
    const create = await c.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: c.headers,
      payload: body,
    });
    assert.equal(create.statusCode, 200, create.body);
    assert.equal(create.json().state, "waiting");
    assert.equal(create.json().targetId, id);
    assert.ok(
      !Object.hasOwn(c.codex.config.model_providers, id),
      "ticket preparation cannot partially create a gateway",
    );
    const result = await c.input(requestId, secret);
    assert.equal(result.json().state, "succeeded", result.body);
    assert.equal(c.codex.config.model_providers[id]!.name, body.name);
    assert.match(
      c.codex.config.model_providers[id]!.env_key,
      /^NEWBOT_CREDENTIAL_KEY_/,
    );
    assert.equal(
      c.vault.nativeEnv(c.codex.config)[
        c.codex.config.model_providers[id]!.env_key
      ],
      secret,
    );
    assert.ok(!JSON.stringify(c.codex.calls).includes(secret));
    assert.ok(
      !JSON.stringify(
        c.db.raw.prepare("SELECT * FROM managed_credentials").all(),
      ).includes(secret),
    );
    assert.ok(!JSON.stringify(await c.service.settings()).includes(secret));
    const again = await c.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: c.headers,
      payload: body,
    });
    assert.equal(again.json().state, "succeeded");
    assert.equal(
      Object.keys(c.codex.config.model_providers).filter((p) => p === id)
        .length,
      1,
    );
    const revision = (await c.service.settings()).configuration!.revision;
    const other = await c.app.inject({
      method: "POST",
      url: "/api/config",
      headers: c.headers,
      payload: {
        action: "gateway/save",
        requestId: randomUUID(),
        name: body.name,
        baseUrl: body.baseUrl,
        expectedRevision: revision,
      },
    });
    assert.equal(other.statusCode, 200, other.body);
    assert.notEqual(other.json().id, id);
    const raw = await c.app.inject({
      method: "POST",
      url: "/api/config",
      headers: c.headers,
      payload: {
        action: "gateway/save",
        requestId: randomUUID(),
        name: "bad",
        apiKey: secret,
        expectedRevision: revision,
      },
    });
    assert.equal(raw.statusCode, 400);
    assert.ok(!raw.body.includes(secret));
  } finally {
    await c.close();
  }
});

test("private gateway creation fails without leaving partial config; changed revisions and policies prevent consumption", async () => {
  const c = await credentialFixture();
  try {
    async function prepare() {
      const requestId = randomUUID();
      const result = await c.app.inject({
        method: "POST",
        url: "/api/credentials/requests",
        headers: c.headers,
        payload: {
          operation: "provider.save",
          requestId,
          expectedRevision: (await c.service.settings()).configuration!
            .revision,
          name: "Failed gateway",
          baseUrl: "https://example.test/v1",
          retention: "encrypted",
        },
      });
      assert.equal(result.json().state, "waiting");
      return requestId;
    }
    const failed = await prepare();
    c.codex.failWrite = true;
    assert.equal((await c.input(failed, "fixture-key")).json().state, "failed");
    assert.equal(
      c.codex.config.model_providers[newGatewayId(failed)],
      undefined,
    );
    assert.equal(c.vault.hasEntries, false);
    c.codex.failWrite = false;
    const stale = await prepare();
    c.codex.version++;
    assert.equal((await c.input(stale, "fixture-key")).json().state, "failed");
    assert.equal(
      c.codex.config.model_providers[newGatewayId(stale)],
      undefined,
    );
    assert.equal(c.vault.hasEntries, false);
  } finally {
    await c.close();
  }
});

test("private gateway edits replace the key and endpoint together and retain the old binding on failed save", async () => {
  const c = await credentialFixture();
  try {
    async function save(id?: string, fail = false) {
      const settings = await c.service.settings(),
        requestId = randomUUID();
      const p = settings.configuration!.providers.find(
        (p: { id: string; managedCredential?: { version: string } }) =>
          p.id === id,
      );
      const ticket = await c.app.inject({
        method: "POST",
        url: "/api/credentials/requests",
        headers: c.headers,
        payload: {
          operation: "provider.save",
          requestId,
          targetId: id,
          name: "Edited",
          baseUrl: id
            ? "https://changed.example.test/v1"
            : "https://first.example.test/v1",
          expectedRevision: settings.configuration!.revision,
          expectedVaultVersion: p?.managedCredential?.version,
          retention: "encrypted",
        },
      });
      assert.equal(ticket.json().state, "waiting", ticket.body);
      c.codex.failWrite = fail;
      const result = await c.input(requestId, id ? "second-key" : "first-key");
      c.codex.failWrite = false;
      return { id: id || newGatewayId(requestId), result: result.json() };
    }
    const first = await save(),
      previous = structuredClone(c.codex.config.model_providers[first.id]);
    assert.equal((await save(first.id, true)).result.state, "failed");
    assert.deepEqual(c.codex.config.model_providers[first.id], previous);
    assert.equal(
      c.vault.nativeEnv(c.codex.config)[previous.env_key],
      "first-key",
    );
    assert.equal((await save(first.id)).result.state, "succeeded");
    const next = c.codex.config.model_providers[first.id];
    assert.equal(next.base_url, "https://changed.example.test/v1");
    assert.equal(c.vault.nativeEnv(c.codex.config)[next.env_key], "second-key");
    assert.equal(
      c.vault.nativeEnv(c.codex.config)[previous.env_key],
      undefined,
    );
  } finally {
    await c.close();
  }
});

test("skill uninstall archives only discovered standalone personal skills and rejects source, stale-content and link attacks", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbot-skill-remove-")),
    codex = new SkillsCodex(root);
  codex.home = join(root, "codex");
  const path = join(codex.home, "skills", "personal", "SKILL.md");
  mkdirSync(join(codex.home, "skills", "personal"), { recursive: true });
  writeFileSync(path, "# Personal skill\n");
  codex.skills.push({
    name: "personal",
    path,
    scope: "user",
    enabled: true,
    description: "Personal",
    pluginId: null,
  });
  const ctx = await createServer({
    providerRuntime: null,
    directory: join(root, "data"),
    cwd: join(root, "work"),
    codex,
    password: "settings-fixture-login",
    origins: ["http://localhost:3100"],
  });
  try {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost:3100" },
      payload: { password: "settings-fixture-login" },
    });
    const headers = {
      origin: "http://localhost:3100",
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const skills = await ctx.service.skills.list(),
      mine = skills.skills.find((s) => s.path === path)!;
    assert.equal(mine.removable, true);
    assert.ok(
      skills.skills
        .filter((s) => s.scope !== "user")
        .every((s) => !s.removable),
    );
    const doc = await ctx.service.skills.read(mine.id);
    const post = (payload: object) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/agent/action",
        headers,
        payload: { action: "skills/uninstall", ...payload },
      });
    assert.equal(
      (await post({ id: mine.id, sha256: "0".repeat(64) })).statusCode,
      409,
    );
    codex.skills.find((s) => s.path === path)!.pluginId = "plugin-owner";
    assert.equal(
      (await post({ id: mine.id, sha256: doc.sha256 })).statusCode,
      403,
    );
    codex.skills.find((s) => s.path === path)!.pluginId = null;
    const moved = join(codex.home, "skills", "moved");
    mkdirSync(moved);
    writeFileSync(join(moved, "SKILL.md"), "outside");
    const fake = join(codex.home, "skills", "linked");
    symlinkSync(moved, fake);
    codex.skills.push({
      name: "linked",
      path: join(fake, "SKILL.md"),
      scope: "user",
      enabled: true,
      description: "link",
      pluginId: null,
    });
    const linked = (await ctx.service.skills.list()).skills.find(
      (s) => s.name === "linked",
    )!;
    assert.notEqual(
      (await post({ id: linked.id, sha256: doc.sha256 })).statusCode,
      200,
    );
    const ok = await post({ id: mine.id, sha256: doc.sha256 });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().state, "uninstalled");
    assert.equal(existsSync(path), false);
    assert.equal(
      readdirSync(join(codex.home, "newbot-removed-skills")).length,
      1,
    );
    assert.equal(existsSync(join(moved, "SKILL.md")), true);
    assert.ok(
      codex.calls.some(
        (c) =>
          c.method === "skills/config/write" &&
          c.params.path === path &&
          !c.params.enabled,
      ),
    );
  } finally {
    await ctx.app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
