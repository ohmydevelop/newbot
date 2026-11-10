// Fixed native Codex, isolated Home/workspace, no model turns or MCP tool execution.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Codex } from "../server/codex.ts";
import { createServer } from "../server/index.ts";
import { CODEX_VERSION } from "../generated/version.ts";
const root = mkdtempSync(join(tmpdir(), "newbot-recovery-native-")),
  home = join(root, "home"),
  cwd = join(root, "work");
mkdirSync(home);
mkdirSync(cwd);
const file = join(home, "config.toml"),
  secret = "SYNTHETIC_RECOVERY_NATIVE_SECRET";
writeFileSync(
  file,
  `model="gpt-6.1-sol"\nmodel_reasoning_effort="medium"\n[mcp_servers.demo]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(resolve("dist/mcp-test/server.js"))}]\nenabled=true\nenv={PRIVATE_TOKEN="${secret}"}\n`,
);
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
delete process.env.ENABLE_TEST_MCP;
delete process.env.ENABLE_OFFICIAL_MCP;
const codex = new Codex(cwd, () => ({ CODEX_HOME: home })),
  calls = [],
  original = codex.call.bind(codex);
codex.call = async (method, params) => {
  calls.push(method);
  return original(method, params);
};
let ctx;
try {
  await codex.start();
  assert.equal(codex.state, "ready");
  ctx = await createServer({
    providerRuntime: null,
    directory: join(root, "data"),
    cwd,
    codex,
    password: "native-recovery-password",
    origins: ["http://127.0.0.1:3100"],
  });
  const service = ctx.service,
    before = await service.settings(),
    model =
      before.models.find((m) => m.model === "gpt-6.1-sol") || before.models[0],
    effort = model.supportedReasoningEfforts.find(
      (e) => e.reasoningEffort !== "medium",
    ).reasoningEffort;
  const saved = await service.handle("settings/defaults", {
    expectedRevision: before.configuration.revision,
    model: model.model,
    effort,
  });
  assert.equal(saved.state, "applied");
  const writes = () => calls.filter((m) => m === "config/batchWrite").length;
  assert.equal(writes(), 1);
  await assert.rejects(
    service.handle("settings/defaults", {
      expectedRevision: before.configuration.revision,
      model: model.model,
      effort: "medium",
    }),
    (e) => e.configurationIssue.code === "conflict",
  );
  assert.equal(writes(), 1);
  const read = await service.handle("configuration/recover", { mode: "read" });
  assert.equal(read.settings.configuration.defaults.effort, effort);
  const restart = await service.handle("configuration/recover", {
    mode: "reconnect",
  });
  assert.equal(restart.settings.configuration.defaults.effort, effort);
  assert.equal(writes(), 1);
  const external = effort === "high" ? "medium" : "high";
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      /^model_reasoning_effort\s*=.*$/m,
      `model_reasoning_effort="${external}"`,
    ),
  );
  const changed = await service.handle("configuration/recover", {
    mode: "read",
  });
  assert.equal(changed.settings.configuration.defaults.effort, external);
  assert.equal(writes(), 1);
  assert.ok(readFileSync(file, "utf8").includes(secret));
  const valid = readFileSync(file, "utf8");
  writeFileSync(file, `[broken\nsecret="${secret}"`);
  await assert.rejects(
    service.handle("configuration/recover", { mode: "reconnect" }),
    (e) =>
      ["reload_failed", "read_failed"].includes(e.configurationIssue.code) &&
      !e.message.includes(secret) &&
      !e.message.includes(root),
  );
  assert.equal(codex.state, "offline");
  assert.equal(service.busy, false);
  writeFileSync(file, valid);
  const recovered = await service.handle("configuration/recover", {
    mode: "reconnect",
  });
  assert.equal(recovered.settings.configuration.defaults.effort, external);
  assert.equal(codex.state, "ready");
  assert.equal(writes(), 1);
  assert.ok(!JSON.stringify(recovered).includes(secret));
  assert.equal(
    calls.some((m) =>
      ["thread/start", "turn/start", "mcpServer/tool/call"].includes(m),
    ),
    false,
  );
  const out = resolve(".data/configuration-recovery-live");
  mkdirSync(out, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(out, "result.json"),
    JSON.stringify(
      {
        codex: CODEX_VERSION,
        conflictClassification: true,
        readCurrent: true,
        reconnect: true,
        noRepeatedWrites: true,
        externalEditsPreserved: true,
        invalidConfigFailure: true,
        repairAndReconnect: true,
        secretsRedacted: true,
        noModelOrToolExecution: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS native configuration recovery, conflict, no repeated writes, external edits, invalid config and repair/reconnect",
  );
} finally {
  if (ctx) await ctx.app.close();
  else await codex.stopAndWait();
  rmSync(root, { recursive: true, force: true });
}
