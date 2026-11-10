// Native config + local synthetic MCP only; isolated Home/workspace, no model or tool execution.
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
import { httpMcpFixture } from "../tests/http-mcp-fixture.ts";
import { Codex } from "../server/codex.ts";
import { createServer } from "../server/index.ts";
import { configuration } from "../server/configuration.ts";
import { CODEX_VERSION } from "../generated/version.ts";
const root = mkdtempSync(join(tmpdir(), "newbot-mcp-native-")),
  home = join(root, "home"),
  cwd = join(root, "work");
mkdirSync(home);
mkdirSync(cwd);
const path = join(home, "config.toml"),
  secret = "SYNTHETIC_NATIVE_MCP_SECRET";
writeFileSync(
  path,
  `[mcp_servers.local]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(resolve("dist/mcp-test/server.js"))}]\nenabled=true\nstartup_timeout_sec=2\ntool_timeout_sec=10\nenv={PRIVATE_VALUE="${secret}"}\n[mcp_servers.remote]\nurl="http://127.0.0.1:9/mcp"\nenabled=false\nhttp_headers={Authorization="Bearer ${secret}"}\nbearer_token_env_var="MCP_TEST_REF"\n`,
);
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
delete process.env.ENABLE_TEST_MCP;
delete process.env.ENABLE_OFFICIAL_MCP;
process.env.MCP_NATIVE_TEST_TOKEN = secret;
process.env.MCP_CREDENTIAL_ENV_ALLOWLIST = "MCP_NATIVE_TEST_TOKEN";
const http = await httpMcpFixture(secret);
const runtime = new Codex(cwd, () => ({ CODEX_HOME: home }));
let ctx;
try {
  await runtime.start();
  assert.equal(runtime.state, "ready");
  ctx = await createServer({
    providerRuntime: null,
    directory: join(root, "data"),
    cwd,
    codex: runtime,
    password: "native-mcp-test-password",
    origins: ["http://127.0.0.1:3100"],
  });
  const core = configuration(runtime, cwd),
    service = ctx.service,
    revision = async () => (await service.settings()).configuration.revision;
  const settings = await service.settings();
  assert.ok(!JSON.stringify(settings).includes(secret));
  assert.ok(!JSON.stringify(settings.configuration).includes(root));
  const result = await service.handle("mcp/test", {
    id: "local",
    expectedRevision: await revision(),
  });
  assert.equal(result.state, "discovered");
  assert.equal(result.toolCount, 2);
  const before = await revision();
  const saved = await service.handle("mcp/save", {
    id: "local",
    create: false,
    transport: "stdio",
    expectedRevision: before,
    patch: { toolTimeout: 20 },
  });
  assert.equal(saved.state, "applied");
  assert.ok(readFileSync(path, "utf8").includes(secret));
  assert.equal(
    (await core.read()).response.config.mcp_servers.local.tool_timeout_sec,
    20,
  );
  await assert.rejects(
    service.handle("mcp/enabled", {
      id: "local",
      enabled: false,
      expectedRevision: before,
    }),
    { statusCode: 409 },
  );
  await service.handle("mcp/enabled", {
    id: "local",
    enabled: false,
    expectedRevision: await revision(),
  });
  assert.equal(
    (
      await service.handle("mcp/test", {
        id: "local",
        expectedRevision: await revision(),
      })
    ).state,
    "disabled",
  );
  await service.handle("mcp/enabled", {
    id: "local",
    enabled: true,
    expectedRevision: await revision(),
  });
  assert.equal(
    (
      await service.handle("mcp/test", {
        id: "local",
        expectedRevision: await revision(),
      })
    ).state,
    "discovered",
  );
  await service.handle("mcp/save", {
    id: "newhttp",
    create: true,
    transport: "http",
    expectedRevision: await revision(),
    patch: {
      url: http.url,
      bearerEnv: "MCP_NATIVE_TEST_TOKEN",
      enabled: true,
      startupTimeout: 2,
    },
  });
  assert.ok((await core.read()).publicView.mcp.some((m) => m.id === "newhttp"));
  assert.equal(
    (
      await service.handle("mcp/test", {
        id: "newhttp",
        expectedRevision: await revision(),
      })
    ).state,
    "discovered",
  );
  assert.ok(http.authorizedRequests > 0);
  assert.equal(http.toolCalls, 0);
  await service.handle("mcp/save", {
    id: "remote",
    create: false,
    transport: "http",
    expectedRevision: await revision(),
    patch: { bearerEnv: null },
  });
  assert.equal(
    (await core.read()).response.config.mcp_servers.remote
      .bearer_token_env_var ?? null,
    null,
  );
  assert.ok(readFileSync(path, "utf8").includes(secret));
  await service.handle("mcp/save", {
    id: "broken",
    create: true,
    transport: "stdio",
    expectedRevision: await revision(),
    patch: {
      command: join(root, "nonexistent"),
      startupTimeout: 1,
      toolTimeout: 2,
    },
  });
  const failed = await service.handle("mcp/test", {
    id: "broken",
    expectedRevision: await revision(),
  });
  assert.equal(failed.state, "failed");
  assert.ok(!JSON.stringify(failed).includes(root));
  await service.handle("mcp/delete", {
    id: "broken",
    expectedRevision: await revision(),
  });
  await service.handle("mcp/delete", {
    id: "newhttp",
    expectedRevision: await revision(),
  });
  await runtime.restart();
  assert.equal(runtime.state, "ready");
  assert.equal(
    (await core.read()).response.config.mcp_servers.local.tool_timeout_sec,
    20,
  );
  assert.equal(
    (
      await service.handle("mcp/test", {
        id: "local",
        expectedRevision: await revision(),
      })
    ).state,
    "discovered",
  );
  const output = resolve(".data/mcp-config-live");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        codex: CODEX_VERSION,
        create: true,
        privateFieldPreservation: true,
        nativeCAS: true,
        enableDisable: true,
        credentialReferenceRemoval: true,
        delete: true,
        nativeReload: true,
        realMcpDiscovery: true,
        httpMcpDiscovery: true,
        bearerCredential: true,
        failureRedaction: true,
        restartPersistence: true,
        noModelOrToolExecution: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS native MCP create/edit/enable/disable/delete, CAS, reload, discovery/failure and restart persistence",
  );
} finally {
  if (ctx) await ctx.app.close();
  else await runtime.stopAndWait();
  await http.close();
  rmSync(root, { recursive: true, force: true });
}
