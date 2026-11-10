import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const destination = "dist/mcp-test";
await mkdir(destination, { recursive: true });
const app = await build({
  entryPoints: ["examples/test-mcp/app.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  charset: "utf8",
});
const css = await readFile("examples/test-mcp/app.css", "utf8");
const script = app.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
await writeFile(
  `${destination}/metrics.html`,
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>资源监控实验台</title><style>${css}</style></head><body><main id="app"></main><script type="module">${script}</script></body></html>`,
);
await build({
  entryPoints: ["examples/test-mcp/server.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  format: "esm",
  target: "node24",
  outfile: `${destination}/server.js`,
});
console.log("Built test MCP server + bundled MCP App");
await build({
  entryPoints: ["examples/test-elicitation/server.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  format: "esm",
  target: "node24",
  outfile: "dist/mcp-elicitation/server.js",
});
