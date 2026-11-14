// Isolated real native catalog and connector UI; all data and secrets are synthetic.
import { mkdtemp, mkdir, writeFile, rm, cp, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "../server/index.js";
import { Codex } from "../server/codex.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
const root = await mkdtemp(join(tmpdir(), "newbot-connector-ui-"));
const work = join(root, "work"),
  home = join(root, "codex");
await mkdir(work, { recursive: true });
await cp(resolve(".data/codex/.tmp/plugins"), join(home, ".tmp/plugins"), {
  recursive: true,
  filter: (p) => !p.split("/").includes(".git"),
});
await copyFile(
  resolve(".data/codex/.tmp/plugins.sha"),
  join(home, ".tmp/plugins.sha"),
);
const native = new Codex(work, () => ({ CODEX_HOME: home }));
const ctx = await createServer({
  directory: join(root, "app"),
  cwd: work,
  codex: native,
  providerRuntime: new ProviderRuntime(),
  password: "connector-fixture-login",
  origins: ["http://127.0.0.1:3153"],
  webDirectory: resolve(".data/gcf10-web"),
});
const pkg = join(work, "plugins/cloudwalker-fixture");
await mkdir(pkg, { recursive: true });
await mkdir(join(work, ".agents/plugins"), { recursive: true });
await writeFile(
  join(work, ".agents/plugins/marketplace.json"),
  JSON.stringify({
    name: "ui-fixtures",
    plugins: [
      {
        name: "cloudwalker-fixture",
        source: { source: "local", path: "./plugins/cloudwalker-fixture" },
      },
    ],
  }),
);
await writeFile(
  join(pkg, "plugin.json"),
  JSON.stringify({
    name: "cloudwalker-fixture",
    version: "1.0.0",
    description: "仅用于界面验证的连接器",
    extensions: {
      "com.openai": { interface: { displayName: "牧云配置验证" } },
    },
  }),
);
await mkdir(join(pkg, ".codex-plugin"), { recursive: true });
await writeFile(
  join(pkg, ".codex-plugin/plugin.json"),
  JSON.stringify({
    name: "cloudwalker-fixture",
    version: "1.0.0",
    description: "仅用于界面验证",
    interface: { displayName: "牧云配置验证" },
  }),
);
await writeFile(
  join(pkg, ".mcp.json"),
  JSON.stringify({
    mcpServers: { cloudwalker: { command: "node", args: ["main.mjs"] } },
  }),
);
await writeFile(join(pkg, "main.mjs"), "// synthetic fixture");
await writeFile(
  join(pkg, "manifest.json"),
  JSON.stringify({
    manifest_version: "0.3",
    name: "cloudwalker",
    version: "1.0.0",
    description: "仅用于界面验证",
    author: { name: "Test" },
    server: {
      type: "node",
      entry_point: "main.mjs",
      mcp_config: {
        command: "node",
        args: ["${PLUGIN_ROOT}/main.mjs"],
        env: {
          SERVICE_URL: "${user_config.url}",
          TOKEN: "${user_config.token}",
          TLS_FINGERPRINT: "${user_config.fingerprint}",
        },
      },
    },
    user_config: {
      url: {
        type: "string",
        title: "牧云平台地址",
        required: true,
        default: "https://localhost/",
      },
      token: {
        type: "string",
        title: "API Token",
        sensitive: true,
        required: true,
      },
      fingerprint: { type: "string", title: "服务器证书 SHA-256（可选）" },
    },
  }),
);
if (process.env.UI_AUTH_FIXTURE === "true") {
  // Only completion-to-UI feedback is synthesized here. Real OAuth/TLS is tested
  // separately by scripts/test-connector-native.mjs; no Slack account is authorized.
  const call = native.call.bind(native);
  let attempt: { name: string; loginId: string } | undefined;
  native.call = (async (method: any, params: any) => {
    if (method !== "mcpServer/oauth/login") return call(method, params);
    attempt = { name: params.name, loginId: crypto.randomUUID() };
    return { loginId: attempt.loginId, authorizationUrl: "http://127.0.0.1:3153/__fixture/oauth" };
  }) as typeof native.call;
  ctx.app.get("/__fixture/oauth", async (_req, reply) => reply.type("text/html").send('<meta charset="utf-8"><title>测试账号授权</title><p>合成账号，仅验证界面完成反馈。</p><a href="/__fixture/complete">拒绝授权</a>'));
  ctx.app.get("/__fixture/complete", async (_req, reply) => {
    if (attempt) native.emit("event", { method: "mcpServer/oauthLogin/completed", params: { ...attempt, threadId: null, success: false, error: "synthetic denial" } });
    return reply.type("text/html").send('<meta charset="utf-8"><p>已拒绝，请返回工作台。</p>');
  });
}
await native.start();
if (process.env.UI_AUTH_FIXTURE === "true") await ctx.service.handle("plugin/install", {id:"slack@openai-api-curated"});
await ctx.app.listen({ host: "127.0.0.1", port: 3153 });
await writeFile(
  resolve(".data/gcf10-fixture.json"),
  JSON.stringify({ root, home, work }),
);
console.log("Connector fixture ready on 3153");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void ctx.app
        .close()
        .then(() => rm(root, { recursive: true, force: true }))
        .then(() => process.exit(0)),
  );
