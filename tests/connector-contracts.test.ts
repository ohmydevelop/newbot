import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mcpCertificate } from "../server/mcp-certificate.js";
import { mcpOAuthSettings } from "../server/oauth.js";
import {
  pluginDescriptors,
  resolvePluginConfiguration,
} from "../server/plugin-descriptor.js";
import { importTree } from "../server/import-files.js";
import { database } from "../server/db.js";
import { ExtensionRuntime } from "../server/extension-runtime.js";

test("MCP certificate accepts public PEM/DER, rejects keys and malformed bundles, and survives restart scoped to one connector", async () => {
  const root = await mkdtemp(join(tmpdir(), "connector-ca-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(root, "key.pem"),
        "-out",
        join(root, "ca.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
      ],
      { stdio: "ignore" },
    );
    const pem = await readFile(join(root, "ca.pem"), "utf8");
    const key = await readFile(join(root, "key.pem"), "utf8");
    assert.equal(mcpCertificate(pem), pem);
    assert.equal(mcpCertificate(Buffer.from(pem).toString("base64")), pem);
    assert.equal(
      mcpCertificate(Buffer.from(pem + " ".repeat(28000)).toString("base64")),
      pem,
    );
    assert.throws(() => mcpCertificate(key), /私钥/);
    assert.throws(() => mcpCertificate(pem + pem), /无法读取/);
    assert.throws(
      () => mcpCertificate(Buffer.from(pem + key).toString("base64")),
      /私钥/,
    );
    assert.throws(
      () => mcpCertificate(Buffer.from(pem + pem).toString("base64")),
      /无法读取/,
    );
    assert.throws(() => mcpCertificate("invalid"), /无法读取/);
    let db = database(join(root, "db"));
    let ext = new ExtensionRuntime(db);
    ext.apply(ext.revision, [
      {
        keyPath: "mcp_servers.private",
        value: { url: "https://localhost/mcp", tls_ca_certificate: pem },
        mergeStrategy: "replace",
      },
      {
        keyPath: "mcp_servers.normal",
        value: { url: "https://other.example/mcp" },
        mergeStrategy: "replace",
      },
    ]);
    db.raw.close();
    db = database(join(root, "db"));
    ext = new ExtensionRuntime(db);
    assert.equal(
      ext.snapshot().values.mcp_servers.private?.tls_ca_certificate,
      pem,
    );
    assert.equal(
      ext.snapshot().values.mcp_servers.normal?.tls_ca_certificate,
      undefined,
    );
    ext.apply(ext.revision, [
      {
        keyPath: "mcp_servers.private.tls_ca_certificate",
        value: null,
        mergeStrategy: "replace",
      },
    ]);
    assert.equal(
      ext.snapshot().values.mcp_servers.private?.tls_ca_certificate,
      undefined,
    );
    db.raw.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("OAuth callback follows the sole public HTTPS origin after tunnel replacement and preserves explicit setup", () => {
  assert.equal(mcpOAuthSettings({}), undefined);
  assert.equal(
    mcpOAuthSettings({ PUBLIC_ORIGIN: "http://localhost:3100" }),
    undefined,
  );
  assert.equal(
    mcpOAuthSettings({
      PUBLIC_ORIGIN: "https://one.example,https://two.example",
    }),
    undefined,
  );
  assert.equal(
    mcpOAuthSettings({ PUBLIC_ORIGIN: "https://new.example" })?.callback,
    "https://new.example/oauth/mcp/callback",
  );
  assert.equal(
    mcpOAuthSettings({
      PUBLIC_ORIGIN: "https://new.example",
      MCP_OAUTH_CALLBACK_URL: "https://explicit.example/oauth/mcp/callback",
      MCP_OAUTH_CALLBACK_PORT: "4101",
    })?.port,
    4101,
  );
});
test("official-style OAuth MCP declaration retains its client ID, supports configured override and rejects undeclared secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "connector-oauth-"));
  try {
    await writeFile(
      join(root, "plugin.json"),
      JSON.stringify({ name: "oauth-probe", version: "1.0" }),
    );
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          slack: {
            type: "http",
            url: "https://mcp.slack.com/mcp",
            oauth: { client_id: "official-public-client" },
          },
        },
      }),
    );
    const [d] = await pluginDescriptors(
      "oauth-probe@test",
      root,
      (await importTree(root)).digest,
    );
    assert.equal(d.reason, undefined);
    assert.equal(
      resolvePluginConfiguration(d, {}).definition.oauth.client_id,
      "official-public-client",
    );
    assert.equal(
      resolvePluginConfiguration(d, { oauth_client_id: "my-client" }).definition
        .oauth.client_id,
      "my-client",
    );
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          slack: {
            url: "https://mcp.slack.com/mcp",
            oauth: { client_id: "id", client_secret: "must-not-pass-inline" },
          },
        },
      }),
    );
    const [bad] = await pluginDescriptors(
      "oauth-probe@test",
      root,
      (await importTree(root)).digest,
    );
    assert.ok(bad.reason);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native cache resolution uses installed files rather than display version and never creates an empty source", async () => {
  const { installedPluginRoot, installedPluginTree } = await import(
    "../server/plugin-cache.js"
  );
  const { mkdir, access } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "plugin-cache-contract-"));
  try {
    const missing = join(root, "missing");
    await assert.rejects(installedPluginTree(missing));
    await assert.rejects(access(missing));
    const empty = join(root, "empty");
    await mkdir(empty);
    await assert.rejects(installedPluginTree(empty), /为空/);
    const actual = join(
      root,
      "plugins/cache/openai-api-curated/slack/abcdef123456",
    );
    await mkdir(actual, { recursive: true });
    await writeFile(join(actual, "plugin.json"), '{"name":"slack"}');
    assert.equal(
      await installedPluginRoot(root, "openai-api-curated", "slack", "0.1.7"),
      actual,
    );
    await assert.rejects(
      access(join(root, "plugins/cache/openai-api-curated/slack/0.1.7")),
    );
    await mkdir(join(root, "plugins/cache/openai-api-curated/slack/another"), {
      recursive: true,
    });
    await assert.rejects(
      installedPluginRoot(root, "openai-api-curated", "slack", "0.1.7"),
      /实际安装目录/,
    );
    await assert.rejects(
      installedPluginRoot(root, "../escape", "slack", "0.1.7"),
      /标识/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OAuth completion reaches global UI without a chat and excludes raw provider diagnostics; late attempts do not match", async () => {
  const { AgentEvents } = await import("../server/ag-ui.js");
  const { matchesOAuthAttempt } = await import("../shared/mcp-oauth.js");
  const events = new AgentEvents(),
    seen: any[] = [];
  events.on("event", (e) => seen.push(e));
  events.notification({
    method: "mcpServer/oauthLogin/completed",
    params: {
      name: "private",
      threadId: null,
      loginId: "current",
      success: false,
      error: "SENSITIVE_UPSTREAM_ERROR",
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "newbot.mcp.oauth.completed");
  assert.deepEqual(seen[0].value, {
    name: "private",
    loginId: "current",
    success: false,
  });
  assert.equal(JSON.stringify(seen).includes("SENSITIVE"), false);
  assert.equal(
    matchesOAuthAttempt({ id: "private", loginId: "current" }, seen[0].value),
    true,
  );
  assert.equal(
    matchesOAuthAttempt({ id: "private", loginId: "newer" }, seen[0].value),
    false,
  );
  assert.equal(
    matchesOAuthAttempt({ id: "different", loginId: "current" }, seen[0].value),
    false,
  );
  assert.equal(matchesOAuthAttempt({ id: "private" }, seen[0].value), false);
});
