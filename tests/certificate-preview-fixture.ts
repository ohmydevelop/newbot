// Explicit opt-in browser fixture. Real local TLS with an injected DNS/connect route;
// no production endpoint, account or credential is used.
import { createServer } from "node:https";
import { connect } from "node:tls";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { inspectCertificate } from "../server/certificates.js";
import { importTree } from "../server/import-files.js";
export async function certificatePreview(
  ctx: any,
  codex: any,
  directory: string,
) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "tls.key"),
      "-out",
      join(directory, "tls.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(join(directory, "tls.pem"), "utf8");
  const server = createServer(
    { key: readFileSync(join(directory, "tls.key")), cert },
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `https://localhost:${(server.address() as any).port}`;
  codex.runtimeCapabilities = {
    ...codex.runtimeCapabilities,
    mcpCustomCa: true,
    providerCustomCa: true,
  };
  const plugin = join(directory, "tls-plugin");
  mkdirSync(plugin);
  writeFileSync(
    join(plugin, "plugin.json"),
    JSON.stringify({
      name: "tls-plugin",
      version: "1.0.0",
      description: "证书配置验收",
    }),
  );
  writeFileSync(
    join(plugin, "mcp.json"),
    JSON.stringify({ mcpServers: { remote: { url: origin + "/mcp" } } }),
  );
  const tree = await importTree(plugin);
  ctx.db.raw.prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)").run(
    crypto.randomUUID(),
    "plugin",
    "tls-plugin",
    plugin,
    tree.digest,
    JSON.stringify({
      installed: true,
      mcp: ["remote"],
      pluginId: "tls-plugin@newbot-imports",
      version: "1.0.0",
    }),
  );
  const nativeCall = codex.call.bind(codex);
  const summary = {
    id: "tls-plugin@newbot-imports",
    name: "tls-plugin",
    installed: true,
    enabled: true,
    availability: "AVAILABLE",
    installPolicy: "AVAILABLE",
    interface: { displayName: "HTTPS 证书验收插件", shortDescription: "" },
  };
  codex.call = async (method: string, params: any) => {
    if (method === "plugin/read" && params.pluginName === "tls-plugin")
      return {
        plugin: {
          summary,
          description: "",
          skills: [],
          mcpServers: ["remote"],
        },
      };
    const result = await nativeCall(method, params);
    if (method === "plugin/list")
      result.marketplaces.push({
        name: "newbot-imports",
        path: plugin,
        plugins: [summary],
      });
    return result;
  };
  let observations = 0;
  ctx.app.addHook("preHandler", async (req: any, reply: any) => {
    if (
      req.url != "/api/certificates/inspect" ||
      !String(req.body?.address).startsWith(origin)
    )
      return;
    observations++;
    const observation = await inspectCertificate(req.body.address, {
      lookup: (async () => [{ address: "10.8.7.6", family: 4 }]) as any,
      connect: ((options: any) =>
        connect({ ...options, host: "127.0.0.1" })) as any,
    });
    if (req.body.address.endsWith("/slow"))
      await new Promise((r) => setTimeout(r, 2500));
    return reply.send(observation);
  });
  ctx.app.get("/fixture/certificates", () => ({
    origin,
    observations,
    certPath: join(directory, "tls.pem"),
  }));
  console.log(
    "certificateFixture",
    JSON.stringify({ origin, certPath: join(directory, "tls.pem") }),
  );
  return () => server.close();
}
