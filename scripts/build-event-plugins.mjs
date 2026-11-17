import { build } from "esbuild";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
for (const name of ["github-events", "mailbox-events", "relay-events"]) {
  const root = resolve(".data/event-plugins", name);
  const metadata = JSON.parse(
    await readFile(`examples/${name}/.codex-plugin/plugin.json`, "utf8"),
  );
  await mkdir(root + "/.codex-plugin", { recursive: true });
  await build({
    entryPoints: [`examples/${name}/server.ts`],
    outfile: root + "/server.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  await copyFile(
    `examples/${name}/.codex-plugin/plugin.json`,
    root + "/.codex-plugin/plugin.json",
  );
  const variable = name === "github-events" ? "GITHUB_TOKEN" : "MAILBOX_FILE";
  const key = name === "github-events" ? "token" : "file";
  let connection = {
    command: "node",
    args: ["${__dirname}/server.mjs"],
    env: { [variable]: "${user_config." + key + "}" },
  };
  if (name === "relay-events")
    connection = {
      command: "node",
      args: ["${__dirname}/server.mjs"],
      env: {
        RELAY_URL: "${user_config.url}",
        RELAY_ROUTE: "${user_config.route}",
        RELAY_TOKEN: "${user_config.token}",
        RELAY_CA_CERTIFICATE: "${user_config.ca_certificate}",
      },
    };
  await writeFile(
    root + "/.mcp.json",
    JSON.stringify({ mcpServers: { [name]: connection } }),
  );
  await writeFile(
    root + "/newbot-events.json",
    JSON.stringify({
      version: 2,
      profile: "mcp-events-47d95c9",
      sources: [
        {
          id:
            name === "github-events"
              ? "repository"
              : name === "relay-events"
                ? "events"
                : "mailbox",
          label:
            name === "github-events"
              ? "GitHub 仓库事件"
              : name === "relay-events"
                ? "事件桥"
                : "测试信箱",
          server: name,
        },
      ],
    }),
  );
  await writeFile(
    root + "/manifest.json",
    JSON.stringify({
      manifest_version: "0.3",
      name,
      version: metadata.version,
      description: "Newbot event plugin",
      author: { name: "newbot" },
      server: {
        type: "node",
        entry_point: "server.mjs",
        mcp_config: connection,
      },
      user_config:
        name === "relay-events"
          ? {
              url: { type: "string", title: "中继地址", required: true },
              route: { type: "string", title: "接收通道", required: true },
              ca_certificate: {
                type: "string",
                title: "中继 CA 证书（PEM）",
                required: false,
              },
              token: {
                type: "string",
                title: "访问令牌",
                sensitive: true,
                required: true,
              },
            }
          : {
              [key]: {
                type: "string",
                title: name === "github-events" ? "访问令牌" : "消息文件",
                sensitive: name === "github-events",
                required: false,
              },
            },
    }),
  );
  console.log(root);
}
await mkdir("dist/event-relay", { recursive: true });
await build({
  entryPoints: ["services/event-relay/main.ts"],
  outfile: "dist/event-relay/main.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
await mkdir("dist/event-bridge", { recursive: true });
await build({
  entryPoints: ["packages/event-bridge/publisher.ts"],
  outfile: "dist/event-bridge/publisher.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
