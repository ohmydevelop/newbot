// Isolated browser acceptance: real Codex scan/install, synthetic public GitHub responses.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server/index.js";
import { Codex } from "../server/codex.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { zip } from "./import-zip-fixture.js";

const directory = await mkdtemp(join(tmpdir(), "newbot-url-ui-"));
const port = Number(process.env.ISSUE_TEST_PORT || 3145);
const origin = `http://127.0.0.1:${port}`;
const requests: string[] = [];
const record = process.env.URL_IMPORT_EVIDENCE;
if (record) await writeFile(record, "[]\n");
const commits = {
  main: "a".repeat(40),
  "feature/api": "b".repeat(40),
  v1: "c".repeat(40),
};
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requests.push(url.href);
  if (record) await writeFile(record, JSON.stringify(requests, null, 2));
  if (
    url.hostname === "api.github.com" &&
    url.pathname.startsWith("/repos/newbot-fixture/demo")
  ) {
    const path = url.pathname.slice("/repos/newbot-fixture/demo".length);
    if (!path) return Response.json({ default_branch: "main" });
    if (path.startsWith("/commits/")) {
      const ref = decodeURIComponent(path.slice("/commits/".length));
      const sha = commits[ref as keyof typeof commits];
      if (sha) return Response.json({ sha });
    }
    if (path === "/git/ref/tags/v1")
      return Response.json({
        ref: "refs/tags/v1",
        object: { type: "commit", sha: commits.v1 },
      });
    return Response.json({}, { status: 404 });
  }
  if (
    url.hostname === "codeload.github.com" &&
    Object.values(commits).some(
      (sha) => url.pathname === `/newbot-fixture/demo/zip/${sha}`,
    )
  ) {
    const version = url.pathname.endsWith(commits["feature/api"])
      ? "2.0.0"
      : "1.0.0";
    const text = (name: string) =>
      Buffer.from(
        `---\nname: ${name}\ndescription: URL import browser fixture\n---\nSynthetic package for isolated verification.\n`,
      );
    return new Response(
      zip([
        { name: "bundle/skills/standalone/SKILL.md", data: text("standalone") },
        {
          name: "bundle/plugins/demo/.codex-plugin/plugin.json",
          data: Buffer.from(
            JSON.stringify({
              name: "url-demo",
              version,
              description: "GitHub 链接导入测试插件",
              skills: "./skills",
            }),
          ),
        },
        {
          name: "bundle/plugins/demo/skills/demo/SKILL.md",
          data: text("plugin-demo"),
        },
      ]),
    );
  }
  throw new Error(`Unexpected fixture network destination: ${url.origin}`);
}) as typeof fetch;
const cwd = join(directory, "work");
await mkdir(cwd);
const runtime = new Codex(cwd, () => ({
  CODEX_HOME: join(directory, "codex"),
}));
const ctx = await createServer({
  directory,
  cwd,
  codex: runtime,
  providerRuntime: new ProviderRuntime(),
  password: "url-import-browser-fixture",
  origins: [origin],
  webDirectory: resolve(process.env.UI_TEST_CANDIDATE || ".data/issue001-web"),
});
await runtime.start();
if (runtime.state !== "ready") throw Error(runtime.reason);
await ctx.app.listen({ host: "127.0.0.1", port });
console.log("URL import UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void ctx.app
        .close()
        .then(() => rm(directory, { recursive: true, force: true }))
        .then(() => process.exit(0)),
  );
