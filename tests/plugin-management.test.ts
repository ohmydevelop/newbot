import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { ConfigCodex } from "./config-fixture.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { importTree } from "../server/import-files.js";
import type { Json } from "../shared/types.js";

class PluginCodex extends ConfigCodex {
  skillPath = "";
  sourceSkillPath = "";
  standalonePath = "";
  summary = {
    id: "bundle@newbot-imports",
    name: "bundle",
    installed: true,
    enabled: true,
    availability: "AVAILABLE",
    installPolicy: "AVAILABLE",
    interface: { displayName: "测试插件" },
    version: "1.0.0",
  };
  skill() {
    return {
      name: "bundle:included",
      description: "插件组成部分",
      path: this.skillPath,
      scope: "user",
      enabled: true,
      pluginId: this.summary.id,
    };
  }
  override async call(method: any, params: any): Promise<any> {
    if (method === "skills/list")
      return {
        data: [
          {
            cwd: params.cwds[0],
            errors: [],
            skills: [
              this.skill(),
              {
                ...this.skill(),
                name: "standalone",
                path: this.standalonePath,
                pluginId: null,
              },
            ],
          },
        ],
      };
    if (method === "plugin/list")
      return {
        marketplaces: [
          {
            name: "newbot-imports",
            path: "/fixture/market.json",
            plugins: [this.summary],
          },
        ],
        marketplaceLoadErrors: [],
      };
    if (method === "plugin/read")
      return {
        plugin: {
          summary: this.summary,
          skills: [
            { ...this.skill(), path: this.sourceSkillPath || this.skillPath },
          ],
          mcpServers: [],
          hooks: [{ eventName: "Stop" }],
        },
      };
    return super.call(method, params);
  }
}

test("marketplace upgrade checks versions and idle state, reconciles a lost native reply and retains preferences", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-market-update-"));
  const cwd = join(root, "work");
  await mkdir(cwd);
  const codex = new PluginCodex();
  codex.home = join(root, "codex");
  codex.config = { mcp_servers: {}, model_providers: {} };
  codex.skillPath = join(root, "cache/v1/SKILL.md");
  codex.standalonePath = join(root, "independent/SKILL.md");
  Object.assign(codex.summary, {
    localVersion: "1.0.0",
    version: "2.0.0",
    source: { type: "remote" },
  });
  let attempts = 0,
    failBefore = false;
  const nativeCall = codex.call.bind(codex);
  codex.call = async (method: any, params: any): Promise<any> => {
    if (method === "plugin/install") {
      attempts++;
      if (failBefore) throw new Error("synthetic rejected install");
      (codex.summary as Json).localVersion = "2.0.0";
      codex.skillPath = join(root, "cache/v2/SKILL.md");
      throw new Error("synthetic lost reply after commit");
    }
    const value = await nativeCall(method, params);
    if (
      method === "skills/list" &&
      (codex.summary as Json).localVersion === "2.0.0"
    )
      value.data[0].skills.push({
        ...codex.skill(),
        name: "bundle:new",
        path: join(root, "cache/v2/new/SKILL.md"),
      });
    return value;
  };
  const c = await createServer({
    directory: join(root, "data"),
    cwd,
    codex,
    providerRuntime: new ProviderRuntime(),
    password: "synthetic-update",
  });
  try {
    await c.service.configuration.read();
    codex.extensionRuntime!.setPlugin(codex.summary.id, false, true);
    codex.extensionRuntime!.setSkill(codex.skillPath, false);
    const params = {
      id: codex.summary.id,
      expectedVersion: "1.0.0",
      targetVersion: "2.0.0",
    };
    const entry = (await c.service.plugins.list()).entries[0];
    assert.equal(entry.update.available, true);
    await assert.rejects(
      c.service.handle("plugin/update", { ...params, targetVersion: "3.0.0" }),
      /版本/,
    );
    assert.equal(attempts, 0);
    codex.active.add("busy");
    await assert.rejects(c.service.handle("plugin/update", params));
    codex.active.delete("busy");
    assert.equal(attempts, 0);
    failBefore = true;
    await assert.rejects(c.service.handle("plugin/update", params), /尚未确认/);
    assert.equal((codex.summary as Json).localVersion, "1.0.0");
    failBefore = false;
    await c.service.handle("plugin/update", params);
    const detail = await c.service.plugins.read(codex.summary.id);
    assert.equal(detail.version, "2.0.0");
    assert.equal(detail.enabled, false);
    assert.equal(detail.skills.length, 2);
    assert.equal(
      detail.skills.some((s) => s.enabled),
      false,
    );
    assert.equal(
      codex
        .extensionRuntime!.snapshot()
        .values.skills.config.some((s) => s.path.includes("/v1/")),
      false,
    );
    const count = attempts;
    await c.service.handle("plugin/update", params);
    assert.equal(attempts, count, "confirmed version is not installed twice");
    // A process can stop after native installation but before preferences commit.
    // Persist the exact pre-upgrade choices; concurrent reads recover them once.
    c.db.set(
      `plugin-upgrade:${codex.summary.id}`,
      JSON.stringify({
        expectedVersion: "1.0.0",
        targetVersion: "2.0.0",
        enabled: true,
        skills: [
          {
            name: "bundle:included",
            path: join(root, "cache/v1/SKILL.md"),
            enabled: false,
          },
        ],
      }),
    );
    codex.extensionRuntime!.setPlugin(codex.summary.id, false, true);
    await Promise.all([c.service.plugins.list(), c.service.plugins.list()]);
    const recovered = await c.service.plugins.read(codex.summary.id);
    assert.equal(recovered.enabled, true);
    assert.equal(
      recovered.skills.some((s) => s.enabled),
      false,
    );
    assert.equal(c.db.get(`plugin-upgrade:${codex.summary.id}`), undefined);
    assert.equal(
      attempts,
      count,
      "recovery must not install or call model tools again",
    );
    assert.equal(
      (await c.service.plugins.list()).entries[0].update.available,
      false,
    );
  } finally {
    await c.app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "plugin API owns child skills and connectors; private saves have durable owner-bound receipts",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "newbot-plugin-api-")),
      dir = join(root, "data"),
      cwd = join(root, "work"),
      pkg = join(root, "bundle"),
      origin = "http://127.0.0.1:3100";
    await mkdir(cwd);
    await mkdir(join(pkg, "skills", "included"), { recursive: true });
    const codex = new PluginCodex();
    codex.config = { mcp_servers: {}, model_providers: {} };
    codex.home = join(root, "codex");
    codex.skillPath = join(pkg, "skills/included/SKILL.md");
    codex.sourceSkillPath = join(
      root,
      "marketplace-source/skills/included/SKILL.md",
    );
    codex.standalonePath = join(root, "standalone/SKILL.md");
    await mkdir(join(root, "standalone"));
    await writeFile(
      codex.skillPath,
      "---\nname: included\ndescription: bundled\n---\nBundled instructions.",
    );
    await writeFile(
      codex.standalonePath,
      "---\nname: standalone\ndescription: standalone\n---\nIndependent instructions.",
    );
    await writeFile(
      join(pkg, "plugin.json"),
      JSON.stringify({
        name: "bundle",
      }),
    );
    await writeFile(
      join(pkg, "mcp.json"),
      JSON.stringify({ mcpServers: { bundled: { command: "node" } } }),
    );
    await writeFile(
      join(pkg, "manifest.json"),
      JSON.stringify({
        manifest_version: "0.3",
        name: "bundled",
        version: "1.0.0",
        description: "Synthetic connector",
        author: { name: "Test" },
        server: {
          type: "node",
          entry_point: "skills/included/SKILL.md",
          mcp_config: {
            command: "node",
            env: { TOKEN: "${user_config.token}" },
          },
        },
        user_config: {
          token: {
            type: "string",
            title: "API Key",
            sensitive: true,
            required: true,
          },
        },
      }),
    );
    const c = await createServer({
      directory: dir,
      cwd,
      codex,
      providerRuntime: new ProviderRuntime({
        model_provider: "fixture",
        model: "fixture-model",
        model_providers: {
          fixture: {
            name: "fixture",
            base_url: "http://127.0.0.1:1",
            wire_api: "responses",
            requires_openai_auth: false,
          },
        },
      }),
      password: "test-only-plugin",
      origins: [origin],
    });
    try {
      const tree = await importTree(pkg);
      c.db.raw
        .prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)")
        .run(
          "bundle",
          "plugin",
          "bundle",
          pkg,
          tree.digest,
          JSON.stringify({ installed: true, mcp: ["bundled"] }),
        );
      codex.extensionRuntime!.setPlugin(codex.summary.id, true, true);
      const login = await c.app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: { password: "test-only-plugin" },
      });
      const headers = {
        origin,
        cookie: login.headers["set-cookie"]!.toString().split(";")[0],
      };
      const post = (url: string, payload: Json) =>
        c.app.inject({ method: "POST", url, headers, payload });
      const action = (action: string, p: Json = {}) =>
        post("/api/agent/action", { action, ...p });
      const settings = await c.service.settings();
      assert.deepEqual(
        settings.skills.map((s) => s.name),
        ["standalone"],
      );
      assert.deepEqual(
        (await c.service.discoverSettings("skills")).skills!.map((s) => s.name),
        ["standalone"],
      );
      let detail = (
        await action("plugin/read", { id: codex.summary.id })
      ).json();
      assert.equal(detail.skills.length, 1);
      assert.equal(detail.connections.length, 1);
      // Legacy UI toggled the source path after installation cached a default.
      codex.extensionRuntime!.setSkill(codex.skillPath, true);
      codex.extensionRuntime!.setSkill(codex.sourceSkillPath, false);
      detail = (await action("plugin/read", { id: codex.summary.id })).json();
      assert.equal(detail.skills[0].enabled, false);
      assert.equal(
        codex.extensionRuntime!.skillEnabled(codex.skillPath, true),
        false,
      );
      assert.equal(
        codex
          .extensionRuntime!.snapshot()
          .values.skills.config.some((s) => s.path === codex.sourceSkillPath),
        false,
      );
      codex.extensionRuntime!.setSkill(codex.skillPath, true);
      detail = (await action("plugin/read", { id: codex.summary.id })).json();
      assert.deepEqual(detail.hooks, ["Stop"]);
      assert.equal(
        (await c.service.configuration.read()).publicView.mcp.length,
        0,
      );
      const document = (
        await action("plugin/skill/read", {
          pluginId: detail.id,
          id: detail.skills[0].id,
        })
      ).json();
      assert.match(document.content, /Bundled instructions/);
      const rejected = await action("plugin/skill/read", {
        pluginId: detail.id,
        id: settings.skills[0].id,
      });
      assert.ok(rejected.statusCode >= 400);
      const disabled = await action("plugin/skill/enabled", {
        pluginId: detail.id,
        id: detail.skills[0].id,
        expectedRevision: detail.extensionRevision,
        enabled: false,
      });
      assert.equal(disabled.statusCode, 200, disabled.body);
      detail = disabled.json();
      assert.equal(detail.skills[0].enabled, false);
      const capture = await c.service.extensions!.capture();
      assert.equal(
        capture!.config.skills.config.find(
          (s: Json) => s.path === codex.skillPath,
        ).enabled,
        false,
      );
      // Re-enable before normalizing saved selections; the plugin remains the public unit.
      await action("plugin/skill/enabled", {
        pluginId: detail.id,
        id: detail.skills[0].id,
        expectedRevision: detail.extensionRevision,
        enabled: true,
      });
      const threadId = randomUUID();
      c.db.raw
        .prepare("INSERT INTO threads VALUES(?,?,?,?,0)")
        .run(threadId, "legacy", "fixture", Date.now());
      const legacy = {
        id: document.skill.id,
        name: document.skill.name,
        displayName: "Included",
        scope: "user",
        sha256: document.sha256,
      };
      c.db.raw
        .prepare("INSERT INTO session_inputs VALUES(?,1,?)")
        .run(threadId, JSON.stringify({ skills: [legacy], plugins: [] }));
      assert.deepEqual(c.service.inputs.get(threadId).skills, []);
      assert.deepEqual(
        c.service.inputs.get(threadId).plugins.map((p) => p.id),
        [codex.summary.id],
      );
      assert.equal(
        c.service.inputs.references("plugins", codex.summary.id),
        true,
      );
      const scattered = await post("/api/config", {
        action: "skills/config/write",
        path: codex.skillPath,
        enabled: false,
        expectedRevision: (await c.service.configuration.read()).publicView
          .revision,
      });
      assert.ok(
        scattered.statusCode >= 400,
        "plugin child must be managed through its owner",
      );
      const expert = await c.service.experts.save({
        name: "bundled expert",
        description: "",
        skillIds: [document.skill.id],
        pluginIds: [],
        connectorIds: [],
      });
      assert.deepEqual(expert.skillIds, []);
      assert.deepEqual(expert.pluginIds, [codex.summary.id]);
      const dispatchedBefore = codex.calls.filter(
        (c) => c.method === "turn/start",
      ).length;
      for (const selection of [
        { plugins: [codex.summary.id] },
        { expertId: expert.id },
      ]) {
        const requestId = randomUUID();
        const notReady = await post("/api/agent/run", {
          requestId,
          text: "Use the selected plugin",
          ...selection,
        });
        assert.ok(notReady.statusCode >= 400, notReady.body);
        assert.match(notReady.json().error, /连接器.*缺少.*API Key/);
        assert.equal(
          c.db.raw
            .prepare("SELECT 1 FROM runs WHERE request_id=?")
            .get(requestId),
          undefined,
        );
      }
      assert.equal(
        codex.calls.filter((c) => c.method === "turn/start").length,
        dispatchedBefore,
      );
      const catalog = (await c.service.experts.list()).catalog;
      assert.deepEqual(
        catalog.skills.map((s) => s.id),
        [settings.skills[0].id],
      );
      const connection = detail.connections[0],
        requestId = randomUUID();
      const metadata = {
        operation: "plugin.configuration.save",
        requestId,
        pluginId: detail.id,
        connectionId: connection.id,
        expectedRevision: connection.revision,
        schemaDigest: connection.schemaDigest,
        values: {},
        enabled: true,
        clearSecrets: [],
      };
      const ticket = await post("/api/credentials/requests", metadata);
      assert.equal(ticket.json().state, "waiting", ticket.body);
      const secret = "api-only-private-plugin-value";
      const outcome = await c.app.inject({
        method: "POST",
        url: `/api/credentials/${requestId}/input`,
        headers: { ...headers, "content-type": "application/octet-stream" },
        payload: Buffer.from(JSON.stringify({ token: secret })).toString(
          "base64",
        ),
      });
      assert.equal(outcome.json().state, "succeeded", outcome.body);
      const revision = (await c.service.pluginConnections.list(detail.id))[0]
        .revision;
      assert.equal(
        (await post("/api/credentials/requests", metadata)).json().state,
        "succeeded",
      );
      assert.equal(
        (await c.service.pluginConnections.list(detail.id))[0].revision,
        revision,
        "duplicate ticket never writes again",
      );
      detail = (await action("plugin/read", { id: detail.id })).json();
      assert.equal(detail.connections[0].configured, true);
      assert.ok(!JSON.stringify(detail).includes(secret));
      const config = (await c.service.configuration.read()).response
        .config as Json;
      assert.equal(
        (await c.privateFields.inject({ config })).config.mcp_servers[
          connection.id
        ].env.TOKEN,
        secret,
      );
      const stranger = await c.app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: { password: "test-only-plugin" },
      });
      const differentOwner = await c.app.inject({
        method: "GET",
        url: `/api/credentials/${requestId}`,
        headers: {
          origin,
          cookie: stranger.headers["set-cookie"]!.toString().split(";")[0],
        },
      });
      assert.ok(differentOwner.statusCode >= 400);
      const independent = await post("/api/config", {
        action: "mcp/enabled",
        id: connection.id,
        expectedRevision: (await c.service.configuration.read()).publicView
          .revision,
        enabled: false,
      });
      assert.ok(
        independent.statusCode >= 400,
        "standalone connector API cannot edit a plugin target",
      );
      codex.active.add("other-running-thread");
      let changed = false;
      await assert.rejects(
        c.service.mutateExtensionAssets(async () => {
          changed = true;
        }),
        /等待任务/,
      );
      assert.equal(
        changed,
        false,
        "asset install cannot borrow the private hot-update bypass",
      );
      codex.active.clear();
      await c.service.mutateExtensionAssets(async () => {
        changed = true;
      });
      assert.equal(changed, true);
    } finally {
      await c.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
