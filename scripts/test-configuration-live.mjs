// Native config contract only: isolated Home/workspace, no provider/model request.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Codex } from "../server/codex.ts";
import { configuration } from "../server/configuration.ts";
import { CODEX_VERSION } from "../generated/version.ts";
const directory = mkdtempSync(join(tmpdir(), "newbot-config-native-"));
const nativeHome = join(directory, "home"),
  cwd = join(directory, "work");
mkdirSync(nativeHome);
mkdirSync(cwd);
const secret = "SYNTHETIC_NATIVE_CONFIG_SECRET";
const configPath = join(nativeHome, "config.toml");
writeFileSync(
  configPath,
  `model="gpt-6.1-sol"\nmodel_reasoning_effort="medium"\n[model_providers.synthetic]\nname="Synthetic"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nenv_key="SYNTHETIC_API_KEY"\nhttp_headers={Authorization="Bearer ${secret}"}\n[mcp_servers.demo]\nurl="http://127.0.0.1:9/mcp"\nenabled=false\nbearer_token_env_var="MCP_TOKEN_REFERENCE"\n`,
);
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
const codex = new Codex(cwd, () => ({ CODEX_HOME: nativeHome }));
try {
  await codex.start();
  assert.equal(codex.state, "ready");
  const store = configuration(codex, cwd);
  const before = await store.read();
  assert.equal(before.publicView.writable, true);
  assert.ok(!JSON.stringify(before.publicView).includes(secret));
  assert.ok(!JSON.stringify(before.publicView).includes(nativeHome));
  assert.equal(
    (await store.read()).publicView.revision,
    before.publicView.revision,
  );
  const saved = await store.writeDefaults(
    {
      expectedRevision: before.publicView.revision,
      model: "gpt-6.1-sol",
      effort: "high",
    },
    async () => {},
  );
  assert.equal(saved.state, "applied");
  assert.equal(saved.configuration.defaults.effort, "high");
  assert.ok(readFileSync(configPath, "utf8").includes(secret)); // Untouched secret-bearing fields remain server-side.
  await assert.rejects(
    store.writeDefaults(
      {
        expectedRevision: before.publicView.revision,
        model: "gpt-6.1-sol",
        effort: "low",
      },
      async () => {},
    ),
    { statusCode: 409 },
  );
  let nativeConflict = false;
  try {
    await codex.call("config/batchWrite", {
      ...before.target,
      edits: [
        {
          keyPath: "model_reasoning_effort",
          value: "low",
          mergeStrategy: "replace",
        },
      ],
    });
  } catch {
    nativeConflict = true;
  }
  assert.equal(nativeConflict, true);
  assert.equal((await store.read()).publicView.defaults.effort, "high");
  await codex.restart();
  assert.equal(codex.state, "ready");
  assert.equal((await store.read()).publicView.defaults.effort, "high");
  const output = resolve(".data/configuration-live");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        codex: CODEX_VERSION,
        redactedRead: true,
        nativeCompareAndSwap: true,
        staleProposalRejected: true,
        secretFieldsPreserved: true,
        restartPersistence: true,
        noModelRequest: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `Native configuration read, CAS write and restart persistence passed (${CODEX_VERSION}); no model request.`,
  );
} finally {
  await codex.stopAndWait();
  rmSync(directory, { recursive: true, force: true });
}
