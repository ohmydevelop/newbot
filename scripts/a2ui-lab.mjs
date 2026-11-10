// Loopback-only laboratory. No product server, Codex, credentials or arbitrary input.
import Fastify from "fastify";
import { build } from "esbuild";
import { verifyA2uiFixtures } from "./verify-a2ui-fixtures.mjs";

export async function createA2uiLab(
  port = Number(process.env.A2UI_TEST_PORT || 3123),
  options = {},
) {
  verifyA2uiFixtures();
  const bundle = await build({
    entryPoints: [
      options.catalog
        ? "examples/a2ui/catalog-demo.tsx"
        : "examples/a2ui/main.tsx",
    ],
    bundle: true,
    write: false,
    outdir: "lab",
    format: "esm",
    platform: "browser",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const app = Fastify();
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
  });
  for (const extension of ["js", "css"]) {
    const file = bundle.outputFiles.find((f) =>
      f.path.endsWith(`.${extension}`),
    );
    if (!file) throw new Error(`Missing lab ${extension}`);
    app.get(`/lab.${extension}`, async (_request, reply) =>
      reply
        .type(extension === "js" ? "text/javascript" : "text/css")
        .send(file.text),
    );
  }
  app.get("/", async (_request, reply) =>
    reply
      .type("text/html")
      .send(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>A2UI 官方样例 · Minimal Agent</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/lab.css"></head><body><div id="root"></div><script type="module" src="/lab.js"></script></body></html>`,
      ),
  );
  await app.listen({ host: "127.0.0.1", port });
  return app;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const app = await createA2uiLab(undefined, {
    catalog: process.env.A2UI_CATALOG === "1",
  });
  console.log(`A2UI lab ready: ${app.listeningOrigin}`);
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => void app.close());
}
