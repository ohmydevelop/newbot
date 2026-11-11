// Pinned native runtime, isolated packages and synthetic values; no model or business API.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Codex } from "../server/codex.ts";
import { createServer } from "../server/index.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
import { zip } from "../tests/import-zip-fixture.ts";
const directory = await mkdtemp(join(tmpdir(), "newbot-plugin-upgrade-"));
const cwd = join(directory, "work"),
  home = join(directory, "codex");
await mkdir(cwd);
await mkdir(home);
const evidence = resolve(
  process.env.PLUGIN_UPGRADE_EVIDENCE ||
    ".issue/2026-11-10/evidence-plugin-lifecycle",
);
await mkdir(evidence, { recursive: true });
process.env.ENABLE_TEST_MCP = "false";
process.env.EXPERIMENTAL_PLUGINS = "true";
let ctx,
  stage = "start";
const checks = [],
  id = "upgrade-demo@newbot-imports";
async function open() {
  const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
  ctx = await createServer({
    directory,
    cwd,
    codex: native,
    providerRuntime: new ProviderRuntime(),
    password: "synthetic-upgrade-password",
  });
  await native.start();
  assert.equal(native.state, "ready");
  await ctx.service.configuration.read();
}
const skill = (name, version) =>
  `---\nname: ${name}\ndescription: synthetic ${name}\n---\nVersion ${version}.`;
function files(version, extra = false, name = "upgrade-demo") {
  return {
    ".codex-plugin/plugin.json": JSON.stringify({
      name,
      version,
      skills: "./skills/",
      mcpServers: "./mcp.json",
    }),
    "mcp.json": JSON.stringify({ mcpServers: { demo: { command: "node" } } }),
    "manifest.json": JSON.stringify({
      manifest_version: "0.3",
      name: "demo",
      version,
      description: "Synthetic connector",
      author: { name: "Test" },
      server: {
        type: "node",
        entry_point: "connector.mjs",
        mcp_config: {
          command: "node",
          env: {
            TEST_URL: "${user_config.url}",
            TEST_KEY: "${user_config.key}",
          },
        },
      },
      user_config: {
        url: { type: "string", title: "地址", required: true },
        key: { type: "string", title: "Key", required: true, sensitive: true },
      },
    }),
    "connector.mjs": "// inert fixture",
    "skills/alpha/SKILL.md": skill("alpha", version),
    "skills/beta/SKILL.md": skill("beta", version),
    ...(extra ? { "skills/new/SKILL.md": skill("new", version) } : {}),
  };
}
async function scan(data, update = false, archive = false) {
  const session = await ctx.imports.create({
    kind: archive ? "zip" : "files",
    name: "synthetic-package",
    ...(update ? { updatePluginId: id } : {}),
  });
  if (archive)
    await ctx.imports.upload(
      session.id,
      "",
      zip(
        Object.entries(data).map(([name, value]) => ({
          name,
          data: Buffer.from(value),
        })),
      ),
      true,
    );
  else
    for (const [path, value] of Object.entries(data))
      await ctx.imports.upload(session.id, path, Buffer.from(value));
  return ctx.imports.scan(session.id);
}
function operation(session, selected) {
  return {
    operationId: randomUUID(),
    digest: session.digest,
    choices: session.entries.map((entry) => ({
      id: entry.id,
      confirmPackage: true,
      replace: !!entry.previousDigest,
      skills: selected ?? entry.selectedSkills ?? entry.skills.map((s) => s.id),
    })),
  };
}
async function install(session, selected) {
  const op = operation(session, selected),
    result = await ctx.imports.install(session.id, op);
  assert.equal(
    result.entries[0].state,
    "installed",
    JSON.stringify(result.entries),
  );
  return op;
}
async function saveConnection(values, secrets) {
  const c = (await ctx.service.pluginConnections.list(id))[0];
  const input = {
    operation: "plugin.configuration.save",
    requestId: randomUUID(),
    pluginId: id,
    connectionId: c.id,
    expectedRevision: c.revision,
    schemaDigest: c.schemaDigest,
    values,
    enabled: true,
    clearSecrets: [],
  };
  const consumer = await ctx.service.pluginConnections.prepare(input);
  const buffer = Buffer.from(
    Buffer.from(JSON.stringify(secrets)).toString("base64"),
  );
  try {
    await consumer.run(
      buffer,
      new AbortController().signal,
      () => true,
      () => {},
    );
  } finally {
    buffer.fill(0);
  }
}
async function detail() {
  return ctx.service.plugins.read(id);
}
try {
  await open();
  let session = await scan(files("1.0.0"));
  await install(
    session,
    session.entries[0].skills
      .filter((s) => s.name.endsWith(":alpha"))
      .map((s) => s.id),
  );
  await saveConnection(
    { url: "https://synthetic.invalid" },
    { key: "SYNTHETIC_UPGRADE_ONLY" },
  );
  let prior = await detail();
  await writeFile(
    join(evidence, "native-upgrade-skill-baseline.json"),
    JSON.stringify(
      {
        scanned: session.entries[0].skills,
        detail: prior.skills,
        preferences: ctx.runtime.extensionRuntime.snapshot().values.skills,
        native: (
          await ctx.runtime.call("skills/list", {
            cwds: [cwd],
            forceReload: true,
          })
        ).data
          .flatMap((d) => d.skills)
          .filter((s) => s.pluginId === id),
        rawDetail: (
          await ctx.runtime.call("plugin/read", {
            marketplacePath: join(
              directory,
              "imports/marketplace/.agents/plugins/marketplace.json",
            ),
            pluginName: "upgrade-demo",
          })
        ).plugin.skills,
      },
      null,
      2,
    ),
  );
  assert.equal(
    prior.skills.find((s) => s.name.endsWith(":beta")).enabled,
    false,
  );
  const alphaId = prior.skills.find((s) => s.name.endsWith(":alpha")).id;
  ctx.runtime.extensionRuntime.setPlugin(id, false, true);
  stage = "preview";
  session = await scan(files("2.0.0", true), true, true);
  const entry = session.entries[0];
  assert.equal(entry.previousVersion, "1.0.0");
  assert.equal(entry.version, "2.0.0");
  assert.equal(entry.previousEnabled, false);
  assert.equal(entry.selectedSkills.length, 1);
  assert.equal(
    entry.skills.find((s) => entry.selectedSkills.includes(s.id)).name,
    "upgrade-demo:alpha",
  );
  const noConsent = operation(session);
  noConsent.choices[0].replace = false;
  await assert.rejects(ctx.imports.install(session.id, noConsent), /明确选择/);
  const firstOp = await install(session);
  prior = await detail();
  assert.equal(prior.id, id);
  assert.equal(prior.version, "2.0.0");
  assert.equal(prior.enabled, false);
  assert.equal(prior.skills.find((s) => s.name.endsWith(":alpha")).id, alphaId);
  assert.deepEqual(
    prior.skills.filter((s) => s.enabled).map((s) => s.name),
    ["upgrade-demo:alpha"],
  );
  const connection = prior.connections[0];
  assert.equal(
    connection.fields.find((f) => f.id === "url").value,
    "https://synthetic.invalid",
  );
  assert.equal(connection.fields.find((f) => f.id === "key").stored, false);
  assert.equal(connection.reviewRequired, true);
  assert.equal(connection.configured, false);
  await ctx.imports.install(session.id, firstOp);
  checks.push(
    "ZIP upgrade keeps native identity, stable skill ID, parent disable and child preferences; new skill off; version/diff consent; repeat operation idempotent",
  );
  checks.push(
    "ordinary configuration preserved; old secret never authorizes new code until fresh private save",
  );
  await saveConnection(
    { url: "https://synthetic.invalid" },
    { key: "SYNTHETIC_UPGRADE_NEW" },
  );
  assert.equal((await detail()).connections[0].configured, true);
  stage = "stale-preferences";
  session = await scan(files("3.0.0", true), true);
  prior = await detail();
  await ctx.service.plugins.skill("plugin/skill/enabled", {
    pluginId: id,
    id: alphaId,
    expectedRevision: prior.extensionRevision,
    enabled: false,
  });
  await assert.rejects(
    ctx.imports.install(session.id, operation(session)),
    /技能选择已变化/,
  );
  await ctx.imports.discard(session.id);
  checks.push("stale upgrade preview cannot overwrite a later skill choice");
  stage = "failure-rollback";
  session = await scan(files("3.0.0", true), true);
  const nativeCall = ctx.runtime.call.bind(ctx.runtime);
  let installs = 0;
  ctx.runtime.call = async (method, params, ...rest) => {
    const value = await nativeCall(method, params, ...rest);
    if (method === "plugin/install") {
      installs++;
      throw new Error("Synthetic failure after native install");
    }
    return value;
  };
  const failed = await ctx.imports.install(session.id, operation(session));
  assert.equal(failed.entries[0].state, "failed");
  assert.equal(installs, 1);
  ctx.runtime.call = nativeCall;
  prior = await detail();
  assert.equal(prior.version, "2.0.0");
  assert.equal(prior.enabled, false);
  assert.equal(
    prior.skills.some((s) => s.enabled),
    false,
  );
  assert.equal(prior.connections[0].configured, true);
  await install(failed, []);
  checks.push(
    "post-install failure restores old package, credentials and toggles; retry upgrades only failed item",
  );
  stage = "same-content";
  session = await scan(files("3.0.0", true), true);
  prior = await detail();
  await ctx.service.plugins.skill("plugin/skill/enabled", {
    pluginId: id,
    id: alphaId,
    expectedRevision: prior.extensionRevision,
    enabled: true,
  });
  const same = await ctx.imports.install(session.id, operation(session));
  assert.equal(same.entries[0].state, "skipped");
  assert.equal(
    same.entries[0].selectedSkills.length,
    1,
    "a skip reports current preferences, not stale import-time choices",
  );
  stage = "wrong-target";
  await assert.rejects(
    scan(files("4.0.0", false, "different-plugin"), true),
    /同名的完整插件/,
  );
  const failedSession = ctx.imports
    .list()
    .find((s) => s.state === "failed" && s.retained);
  if (failedSession) await ctx.imports.discard(failedSession.id);
  stage = "competing-upgrade";
  const a = await scan(files("4.0.0", true), true),
    b = await scan(files("5.0.0", true), true);
  await install(a, []);
  await assert.rejects(ctx.imports.install(b.id, operation(b)), /扫描时不同/);
  await ctx.imports.discard(b.id);
  checks.push(
    "same content skips; wrong plugin rejected; competing upgrade invalidates old preview",
  );
  stage = "restart";
  assert.equal(
    await readFile(join(home, "config.toml"), "utf8").catch(() => ""),
    "",
  );
  await ctx.app.close();
  await open();
  prior = await detail();
  assert.equal(prior.version, "4.0.0");
  assert.equal(prior.enabled, false);
  assert.equal(
    prior.skills.some((s) => s.enabled),
    false,
  );
  assert.equal(
    (await ctx.service.configuration.read()).publicView.mcp.some(
      (m) => m.id === prior.connections[0].id,
    ),
    false,
  );
  checks.push(
    "SQLite restores installed version and choices after full restart; component absent from independent configuration; personal config untouched",
  );
  await writeFile(
    join(evidence, "native-upgrade.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        runtime: ctx.runtime.version,
        modelRequests: 0,
        businessRequests: 0,
        checks,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (error) {
  await writeFile(
    join(evidence, "native-upgrade-failure.json"),
    JSON.stringify(
      { stage, error: String(error), stack: error.stack, checks },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await ctx?.app.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
