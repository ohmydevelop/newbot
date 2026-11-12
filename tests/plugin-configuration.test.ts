import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { credentialVault } from "../server/credential-vault.js";
import { ExtensionRuntime } from "../server/extension-runtime.js";
import { pluginConnections } from "../server/plugin-connections.js";
import {
  pluginPackageDeclarations,
  pluginDescriptors,
  resolvePluginConfiguration,
} from "../server/plugin-descriptor.js";
import { importTree } from "../server/import-files.js";
import {
  privateFields,
  legacyPrivateFieldBinding,
  privateFieldBinding,
} from "../server/private-fields.js";
import { mcpEditable } from "../server/mcp-policy.js";
import type { Json } from "../shared/types.js";

const marker = "synthetic-plugin-secret-MUST-NOT-ESCAPE";
const raw = () =>
  ({
    config: { mcp_servers: {}, plugins: {} },
    origins: {},
    layers: [],
  }) as any;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "newbot-plugin-config-"));
  await mkdir(join(root, "work"));
  let db = database(join(root, "data"));
  let vault = credentialVault(db, join(root, "data"), join(root, "work"));
  let extensions = new ExtensionRuntime(db);
  extensions.overlay(raw());
  let connections = pluginConnections(db, extensions, vault);
  async function install(
    name: string,
    def: Json = {
      command: "node",
      args: ["${PLUGIN_ROOT}/main.mjs"],
      env: {
        SERVICE_URL: "${user_config.url}",
        SERVICE_KEY: "${user_config.key}",
      },
    },
    fields: Json = {
      url: { type: "string", title: "服务地址", required: true },
      key: { type: "string", title: "密钥", sensitive: true, required: true },
    },
  ) {
    const path = join(root, name);
    await mkdir(path);
    await writeFile(
      join(path, "plugin.json"),
      JSON.stringify({
        name,
        version: "1.0",
      }),
    );
    await writeFile(
      join(path, "mcp.json"),
      JSON.stringify({
        mcpServers: { same: { command: "node", args: ["main.mjs"] } },
      }),
    );
    await writeFile(
      join(path, "manifest.json"),
      JSON.stringify({
        manifest_version: "0.3",
        name: "same",
        version: "1.0.0",
        description: "Synthetic connector",
        author: { name: "Test" },
        server: { type: "node", entry_point: "main.mjs", mcp_config: def },
        user_config: fields,
      }),
    );
    await writeFile(join(path, "main.mjs"), "// inert fixture");
    const tree = await importTree(path);
    db.raw
      .prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)")
      .run(
        randomUUID(),
        "plugin",
        name,
        path,
        tree.digest,
        JSON.stringify({ installed: true, mcp: ["same"] }),
      );
    extensions.setPlugin(`${name}@newbot-imports`, true, true);
    return `${name}@newbot-imports`;
  }
  const view = async (id: string) => (await connections.list(id))[0];
  async function save(
    id: string,
    values: Json = { url: "https://one.example" },
    secret: Json = { key: marker },
    extra: Json = {},
  ) {
    const c = await view(id),
      requestId = randomUUID();
    const input = {
      operation: "plugin.configuration.save" as const,
      requestId,
      pluginId: id,
      connectionId: c.id,
      expectedRevision: c.revision,
      schemaDigest: c.schemaDigest,
      values,
      enabled: true,
      clearSecrets: [],
      ...extra,
    };
    db.raw
      .prepare("INSERT INTO private_operations VALUES(?,?,?,NULL,?)")
      .run(requestId, "owner", "fingerprint", Date.now());
    const consumer = await connections.prepare(input);
    const bytes = Buffer.from(
      Buffer.from(JSON.stringify(secret)).toString("base64"),
    );
    try {
      await consumer.run(
        bytes,
        new AbortController().signal,
        () => true,
        () => {},
      );
    } finally {
      bytes.fill(0);
    }
    return input;
  }
  async function config(): Promise<any> {
    return connections.overlay(extensions.overlay(raw()));
  }
  async function inject(config: Json) {
    const fields = privateFields(db, vault, {
      read: async () => ({ response: { config } }),
    } as any);
    return fields.inject({
      modelProvider: "none",
      config: structuredClone(config),
    });
  }
  return {
    root,
    install,
    view,
    save,
    config,
    inject,
    get vault() {
      return vault;
    },
    get db() {
      return db;
    },
    get connections() {
      return connections;
    },
    get extensions() {
      return extensions;
    },
    restart() {
      db.raw.close();
      db = database(join(root, "data"));
      vault = credentialVault(db, join(root, "data"), join(root, "work"));
      extensions = new ExtensionRuntime(db);
      connections = pluginConnections(db, extensions, vault);
    },
    async close() {
      db.raw.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("plugin settings preserve ownership, encrypt credentials and recover without config files", async () => {
  const f = await fixture();
  try {
    const id = await f.install("first");
    assert.equal((await f.view(id)).configured, false);
    const op = await f.save(id);
    const view = await f.view(id);
    assert.equal(view.configured, true);
    assert.equal(view.fields.find((f) => f.id === "key")?.stored, true);
    const response = await f.config();
    assert.equal(mcpEditable(response, view.id), false);
    assert.equal(response.config.plugins[id].mcp_servers.same.enabled, false);
    assert.equal(response.config.mcp_servers[view.id].enabled, true);
    assert.equal(
      response.config.mcp_servers[view.id].env.SERVICE_KEY,
      undefined,
    );
    const injected = await f.inject(response.config);
    assert.equal(injected.config.mcp_servers[view.id].env.SERVICE_KEY, marker);
    assert.equal(injected.config.newbot_plugin_connections, undefined);
    for (const table of [
      "plugin_connection_settings",
      "private_field_sets",
      "private_operations",
      "extension_configuration",
    ])
      assert.ok(
        !JSON.stringify(
          f.db.raw.prepare(`SELECT * FROM ${table}`).all(),
        ).includes(marker),
        table,
      );
    assert.ok(!JSON.stringify(view).includes(marker));
    assert.equal(
      JSON.parse(
        (
          f.db.raw
            .prepare("SELECT result FROM private_operations WHERE id=?")
            .get(op.requestId) as any
        ).result,
      ).state,
      "succeeded",
    );
    f.restart();
    assert.equal((await f.view(id)).configured, true);
    assert.equal(
      (await f.inject((await f.config()).config)).config.mcp_servers[view.id]
        .env.SERVICE_KEY,
      marker,
    );
  } finally {
    await f.close();
  }
});

test("same-name connectors in different plugins stay isolated, including disable and uninstall", async () => {
  const f = await fixture();
  try {
    const a = await f.install("first"),
      b = await f.install("second");
    await f.save(a);
    await f.save(b, undefined, { key: "second-key" });
    const av = await f.view(a),
      bv = await f.view(b);
    assert.notEqual(av.id, bv.id);
    const before = (await f.config()).config;
    f.extensions.setPlugin(a, false, true);
    const after = (await f.config()).config;
    const injected = await f.inject(after);
    assert.equal(injected.config.mcp_servers[av.id].enabled, false);
    assert.equal(injected.config.mcp_servers[av.id].env.SERVICE_KEY, undefined);
    assert.equal(
      injected.config.mcp_servers[bv.id].env.SERVICE_KEY,
      "second-key",
    );
    assert.equal(
      before.mcp_servers[av.id].enabled,
      true,
      "existing snapshots must not be mutated",
    );
    f.connections.remove(a);
    f.extensions.setPlugin(a, false, false);
    assert.equal((await f.connections.list(a)).length, 0);
    assert.equal((await f.view(b)).configured, true);
  } finally {
    await f.close();
  }
});

test("plugin saves reject missing or invalidated credentials atomically instead of reporting success", async () => {
  const f = await fixture();
  try {
    const id = await f.install(
      "atomic",
      {
        command: "node",
        args: ["${PLUGIN_ROOT}/main.mjs"],
        env: {
          SERVICE_URL: "${user_config.url}",
          SERVICE_KEY: "${user_config.key}",
          SERVICE_OPTION: "${user_config.option}",
        },
      },
      {
        url: { type: "string", title: "服务地址", required: true },
        key: { type: "string", title: "密钥", sensitive: true, required: true },
        option: { type: "string", title: "连接参数", default: "" },
      },
    );
    await assert.rejects(f.save(id, undefined, {}), /请填写.*密钥/);
    assert.equal((await f.view(id)).revision, "absent");
    await f.save(id);
    const before = await f.view(id);
    const packet = f.db.raw
      .prepare("SELECT * FROM private_field_sets WHERE target=?")
      .get(before.id);
    await assert.rejects(
      f.save(id, { url: "https://one.example", option: "new-value" }, {}),
      /重新填写.*密钥/,
    );
    assert.equal((await f.view(id)).revision, before.revision);
    assert.equal((await f.view(id)).configured, true);
    assert.deepEqual(
      f.db.raw
        .prepare("SELECT * FROM private_field_sets WHERE target=?")
        .get(before.id),
      packet,
    );
    await f.save(id, undefined, {});
    assert.equal(
      (await f.inject((await f.config()).config)).config.mcp_servers[before.id]
        .env.SERVICE_KEY,
      marker,
    );
    await f.save(id, undefined, {}, { enabled: false });
    assert.equal(
      (await f.view(id)).fields.find((x) => x.id === "key")?.stored,
      true,
    );
    await f.save(id, undefined, {}, { clearSecrets: ["key"] });
    assert.equal((await f.view(id)).configured, false);
    assert.match((await f.view(id)).reason!, /缺少.*密钥/);
    await assert.rejects(f.save(id, undefined, {}), /请填写.*密钥/);
    await f.save(id);
    assert.equal((await f.view(id)).configured, true);
  } finally {
    await f.close();
  }
});

test("selected plugin readiness uses the captured configuration and leaves unrelated or intentionally disabled connectors alone", async () => {
  const f = await fixture();
  try {
    const a = await f.install("selected"),
      b = await f.install("unrelated");
    await assert.rejects(
      f.connections.requireConfigured([a]),
      /连接器.*缺少.*密钥/,
    );
    await f.connections.requireConfigured([]);
    const stale = (await f.config()).config;
    await f.save(a);
    await f.connections.requireConfigured([a], (await f.config()).config);
    await assert.rejects(
      f.connections.requireConfigured([a], stale),
      /本轮.*配置/,
    );
    assert.equal((await f.view(b)).configured, false);
    await f.save(a, undefined, {}, { enabled: false, clearSecrets: ["key"] });
    await f.connections.requireConfigured([a], (await f.config()).config);
  } finally {
    await f.close();
  }
});

test("endpoint/package changes cannot inherit secrets and concurrent writes preserve the first save", async () => {
  const f = await fixture();
  try {
    const id = await f.install("first");
    const stale = await f.save(id);
    await assert.rejects(f.connections.prepare(stale), /已变化/);
    const v = await f.view(id);
    const metadata = {
      ...stale,
      requestId: randomUUID(),
      expectedRevision: v.revision,
    };
    const delayed = await f.connections.prepare(metadata);
    await f.save(
      id,
      { url: "https://two.example" },
      {},
      { clearSecrets: ["key"] },
    );
    await assert.rejects(
      delayed.run(
        Buffer.from("e30="),
        new AbortController().signal,
        () => true,
        () => {},
      ),
      /已变化/,
    );
    assert.equal(
      (await f.view(id)).configured,
      false,
      "secret must not be reused at a new recipient",
    );
    await f.save(id, { url: "https://two.example" });
    await f.save(
      id,
      { url: "https://two.example" },
      {},
      { clearSecrets: ["key"] },
    );
    assert.equal((await f.config()).config.mcp_servers[v.id].enabled, false);
    await writeFile(join(f.root, "first", "main.mjs"), "// changed package");
    assert.match((await f.view(id)).reason!, /资源已变化/);
    assert.equal((await f.config()).config.mcp_servers[v.id].enabled, false);
  } finally {
    await f.close();
  }
});

test("upgrades preserve compatible ordinary fields while invalidating code-bound credentials", async () => {
  const f = await fixture();
  try {
    const id = await f.install("upgrade");
    await f.save(id);
    const before = await f.view(id);
    const path = join(f.root, "upgrade");
    await writeFile(join(path, "main.mjs"), "// new version");
    let tree = await importTree(path);
    f.db.raw
      .prepare("UPDATE extension_packages SET digest=? WHERE name='upgrade'")
      .run(tree.digest);
    let view = await f.view(id);
    assert.equal(view.id, before.id);
    assert.equal(view.reviewRequired, true);
    assert.equal(
      view.fields.find((x) => x.id === "url")?.value,
      "https://one.example",
    );
    assert.equal(view.fields.find((x) => x.id === "key")?.stored, false);
    assert.equal((await f.config()).config.mcp_servers[view.id].enabled, false);
    f.restart();
    assert.equal((await f.view(id)).reviewRequired, true);
    await f.save(id, { url: "https://one.example" }, { key: marker + "-new" });
    assert.equal((await f.view(id)).configured, true);
    const descriptor = JSON.parse(
      await readFile(join(path, "manifest.json"), "utf8"),
    );
    descriptor.user_config.url = {
      type: "number",
      title: "New numeric field",
      required: true,
    };
    await writeFile(join(path, "manifest.json"), JSON.stringify(descriptor));
    tree = await importTree(path);
    f.db.raw
      .prepare("UPDATE extension_packages SET digest=? WHERE name='upgrade'")
      .run(tree.digest);
    view = await f.view(id);
    assert.equal(view.fields.find((x) => x.id === "url")?.value, undefined);
    assert.equal(view.configured, false);
  } finally {
    await f.close();
  }
});

test("MCPB numeric/optional fields and HTTP runtime headers bind only declared destinations", async () => {
  const f = await fixture();
  try {
    const id = await f.install(
      "http",
      {
        command: "node",
        env: {
          SERVICE_URL: "${user_config.url}",
          SERVICE_KEY: "${user_config.key}",
          LIMIT: "${user_config.limit}",
        },
      },
      {
        url: { type: "string", title: "服务地址", required: true },
        key: {
          type: "string",
          title: "API Key",
          sensitive: true,
          required: true,
        },
        limit: { type: "number", title: "数量", min: 1, max: 20, default: 5 },
      },
    );
    await f.save(id);
    const v = await f.view(id),
      injected = await f.inject((await f.config()).config);
    assert.equal(injected.config.mcp_servers[v.id].env.SERVICE_KEY, marker);
    assert.equal(injected.config.mcp_servers[v.id].env.LIMIT, "5");
    await assert.rejects(
      f.save(id, { url: "https://one.example", limit: 99 }),
      /格式不正确/,
    );
    // HTTP remains a native runtime definition, not an invented MCPB server type.
    const path = join(f.root, "http"),
      tree = await importTree(path);
    const descriptor = (await pluginDescriptors(id, path, tree.digest))[0];
    descriptor.definition = {
      url: "${user_config.url}",
      headers: {
        Authorization: "Bearer ${user_config.key}",
        "X-Limit": "${user_config.limit}",
      },
    };
    const resolved = resolvePluginConfiguration(descriptor, {
      url: "https://one.example",
    });
    assert.equal(resolved.definition.http_headers["X-Limit"], "5");
    assert.deepEqual(resolved.secrets[0].field, {
      kind: "bearer",
      name: "Authorization",
    });
    assert.throws(
      () =>
        resolvePluginConfiguration(descriptor, {
          url: "http://remote.example",
        }),
      /HTTPS/,
    );
    await assert.rejects(
      f.save(id, { url: "https://one.example", key: marker }),
      /敏感字段/,
    );
    await assert.rejects(f.save(id, undefined, { unlisted: marker }), /不属于/);
  } finally {
    await f.close();
  }
});

test("unsupported descriptors, sensitive command templates and protected env fail closed", async () => {
  const f = await fixture();
  try {
    for (const [name, config, fields] of [
      [
        "badenv",
        { command: "node", env: { NODE_OPTIONS: "${user_config.key}" } },
        { key: { type: "string", title: "key", sensitive: true } },
      ],
      [
        "badcommand",
        { command: "${user_config.key}" },
        { key: { type: "string", title: "key", sensitive: true } },
      ],
      [
        "badfield",
        { command: "node", args: ["${user_config.folder}"] },
        { folder: { type: "directory", title: "folder" } },
      ],
      ["unknown", { command: "${UNDECLARED}" }, {}],
    ] as [string, Json, Json][]) {
      const id = await f.install(name, config, fields);
      assert.ok((await f.view(id)).reason, name);
      assert.equal((await f.view(id)).configured, false);
    }
  } finally {
    await f.close();
  }
});

test("configuration-free connectors need no credential, and declared manifest paths stay within the package", async () => {
  const f = await fixture();
  try {
    const id = await f.install(
      "noauth",
      { command: "node", args: ["${PLUGIN_ROOT}/main.mjs"] },
      {},
    );
    assert.equal((await f.view(id)).configured, true);
    assert.deepEqual((await f.view(id)).fields, []);
    await f.save(id, {}, {}, { enabled: false });
    assert.equal((await f.view(id)).enabled, false);
    const packageFiles = (await importTree(join(f.root, "noauth"))).files;
    const manifest = packageFiles.find((f) => f.path === "plugin.json")!;
    manifest.data = Buffer.from(
      JSON.stringify({ name: "noauth", mcpServers: "./definitions.json" }),
    );
    const declarations = packageFiles.find((f) => f.path === "mcp.json")!;
    declarations.path = "definitions.json";
    assert.deepEqual(
      Object.keys(pluginPackageDeclarations(packageFiles).defs),
      ["same"],
    );
    manifest.data = Buffer.from(
      JSON.stringify({ name: "noauth", mcpServers: "./../outside.json" }),
    );
    assert.throws(() => pluginPackageDeclarations(packageFiles), /路径/);
  } finally {
    await f.close();
  }
});

test("MCPB discovery uses declared names and manifest-relative roots, rejects obsolete pointers and malformed bundles", async () => {
  const f = await fixture();
  try {
    const id = await f.install("nested"),
      root = join(f.root, "nested");
    const original = (await importTree(root)).files;
    const descriptorFile = original.find((v) => v.path === "manifest.json")!;
    const descriptor = JSON.parse(descriptorFile.data.toString());
    const check = (change: (v: any) => void, pattern: RegExp) => {
      const files = structuredClone(original);
      const value = structuredClone(descriptor);
      change(value);
      files.find((f) => f.path === "manifest.json")!.data = Buffer.from(
        JSON.stringify(value),
      );
      // structuredClone turns Buffers into Uint8Array; normalize the remaining files.
      assert.throws(
        () =>
          pluginPackageDeclarations(
            files.map((f) => ({ ...f, data: Buffer.from(f.data) })),
          ),
        pattern,
      );
    };
    check((v) => {
      delete v.author;
    }, /必需字段/);
    check((v) => {
      v.name = "unrelated";
    }, /名称/);
    check((v) => {
      v.manifest_version = "9.9";
    }, /0.3/);
    check((v) => {
      v.server.entry_point = "../outside";
    }, /路径/);
    check((v) => {
      v.server.entry_point = "missing";
    }, /实际文件/);
    check((v) => {
      v.server.mcp_config.cwd = "arbitrary";
    }, /格式/);
    assert.throws(
      () =>
        pluginPackageDeclarations([
          ...original,
          { ...descriptorFile, path: "duplicate/manifest.json" },
        ]),
      /多个/,
    );
    const plugin = original.find((v) => v.path === "plugin.json")!;
    assert.throws(
      () =>
        pluginPackageDeclarations(
          original.map((f) =>
            f === plugin
              ? {
                  ...f,
                  data: Buffer.from(
                    JSON.stringify({
                      name: "nested",
                      extensions: { "io.newbot": { version: 1 } },
                    }),
                  ),
                }
              : f,
          ),
        ),
      /已移除/,
    );
    const unrelated = {
      ...descriptorFile,
      path: "web/manifest.json",
      data: Buffer.from('{"manifest_version":3,"name":"browser extension"}'),
    };
    assert.equal(
      pluginPackageDeclarations([...original, unrelated]).bundles.size,
      1,
    );
    await mkdir(join(root, "connector"));
    descriptor.server.entry_point = "run.mjs";
    descriptor.server.mcp_config.args = ["${__dirname}/run.mjs"];
    descriptor.server.mcp_config.platform_overrides = {
      linux: { env: { EXTRA: "linux" } },
    };
    await rm(join(root, "manifest.json"));
    await writeFile(
      join(root, "connector/manifest.json"),
      JSON.stringify(descriptor),
    );
    await writeFile(join(root, "connector/run.mjs"), "// fixture");
    const tree = await importTree(root);
    const d = (await pluginDescriptors(id, root, tree.digest))[0];
    assert.equal(d.reason, undefined);
    const config = resolvePluginConfiguration(d, {
      url: "https://one.example",
    });
    assert.deepEqual(config.definition.args, [join(root, "connector/run.mjs")]);
    assert.equal(config.definition.env.EXTRA, "linux");
  } finally {
    await f.close();
  }
});

test("certificate observation validates ownership, field privacy and revision before and after network work", async () => {
  const f = await fixture();
  try {
    const id = await f.install("certificate"),
      c = await f.view(id);
    const p = {
      pluginId: id,
      connectionId: c.id,
      expectedRevision: c.revision,
      schemaDigest: c.schemaDigest,
      fieldId: "url",
      address: "https://one.example",
    };
    let calls = 0;
    const observe = async () => {
      calls++;
      return { fingerprint: "a".repeat(64) } as any;
    };
    await assert.rejects(
      f.connections.certificate({ ...p, fieldId: "key" }, observe),
      /普通文本/,
    );
    await assert.rejects(
      f.connections.certificate(
        { ...p, pluginId: "other@newbot-imports" },
        observe,
      ),
      /移除/,
    );
    await assert.rejects(
      f.connections.certificate({ ...p, expectedRevision: "stale" }, observe),
      /已变化/,
    );
    assert.equal(calls, 0);
    await f.connections.certificate(p, observe);
    assert.equal(calls, 1);
    assert.equal(
      (await f.view(id)).revision,
      "absent",
      "observation does not save configuration or secrets",
    );
    await assert.rejects(
      f.connections.certificate(p, async () => {
        await f.save(id);
        return observe();
      }),
      /已变化/,
    );
    const current = await f.view(id);
    await assert.rejects(
      f.connections.certificate(
        { ...p, expectedRevision: current.revision },
        async () => {
          f.extensions.setPlugin(id, false, false);
          return observe();
        },
      ),
      /移除/,
    );
  } finally {
    await f.close();
  }
});

test("verified plugin relocation keeps credentials bound to the same package and receiver across restart", async () => {
  const f = await fixture();
  try {
    const id = await f.install("portable"),
      c = await f.view(id);
    await f.save(id);
    const before = (await f.config()).config;
    const row = f.db.raw
      .prepare("SELECT * FROM private_field_sets WHERE target=?")
      .get(c.id) as any;
    // Simulate the pre-migration encrypted row, without writing the synthetic plaintext to disk.
    const oldBinding = legacyPrivateFieldBinding("mcp", c.id, before);
    assert.notEqual(oldBinding, privateFieldBinding("mcp", c.id, before));
    const plain = Buffer.from(JSON.stringify({ "env:SERVICE_KEY": marker }));
    try {
      const packet = f.vault.sealPrivate(
        plain,
        `fields:mcp:${c.id}:${oldBinding}`,
      );
      f.db.raw
        .prepare(
          "UPDATE private_field_sets SET binding=?,packet=? WHERE target=?",
        )
        .run(oldBinding, packet, c.id);
    } finally {
      plain.fill(0);
    }
    assert.equal((await f.view(id)).configured, true);
    const migrated = f.db.raw
      .prepare("SELECT * FROM private_field_sets WHERE target=?")
      .get(c.id) as any;
    assert.equal(migrated.binding, row.binding);
    assert.notEqual(migrated.packet, row.packet);
    const moved = join(f.root, "another-node-package");
    await rename(join(f.root, "portable"), moved);
    f.db.raw
      .prepare("UPDATE extension_packages SET path=? WHERE name=?")
      .run(moved, "portable");
    f.restart();
    assert.equal((await f.view(id)).configured, true);
    const actual = (await f.inject((await f.config()).config)).config
      .mcp_servers[c.id];
    assert.equal(actual.env.SERVICE_KEY, marker);
    assert.equal(actual.args[0], join(moved, "main.mjs"));
    assert.ok(!JSON.stringify(await f.view(id)).includes(moved));
    await assert.rejects(
      f.save(id, { url: "https://another.example" }, {}),
      /重新填写/,
    );
    assert.equal(
      (await f.inject((await f.config()).config)).config.mcp_servers[c.id].env
        .SERVICE_KEY,
      marker,
    );
  } finally {
    await f.close();
  }
});

test("a stale physical credential binding is not silently rebound after its original receiver changes", async () => {
  const f = await fixture();
  try {
    const id = await f.install("old-root");
    await f.save(id);
    const c = await f.view(id),
      config = (await f.config()).config;
    const bound = legacyPrivateFieldBinding("mcp", c.id, config),
      plain = Buffer.from(JSON.stringify({ "env:SERVICE_KEY": marker }));
    try {
      f.db.raw
        .prepare(
          "UPDATE private_field_sets SET binding=?,packet=? WHERE target=?",
        )
        .run(
          bound,
          f.vault.sealPrivate(plain, `fields:mcp:${c.id}:${bound}`),
          c.id,
        );
    } finally {
      plain.fill(0);
    }
    const moved = join(f.root, "unexpected-move");
    await rename(join(f.root, "old-root"), moved);
    f.db.raw
      .prepare("UPDATE extension_packages SET path=? WHERE name=?")
      .run(moved, "old-root");
    assert.equal((await f.view(id)).configured, false);
    assert.equal(
      (
        f.db.raw
          .prepare("SELECT binding FROM private_field_sets WHERE target=?")
          .get(c.id) as any
      ).binding,
      bound,
    );
  } finally {
    await f.close();
  }
});
