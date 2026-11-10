// Isolated browser fixture. This file is never bundled into the product server.
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const port = Number(process.env.ARTIFACT_TEST_PORT || 3102);
const directory = mkdtempSync(join(tmpdir(), "newbot-artifact-ui-"));
const cwd = join(directory, "workspace");
mkdirSync(join(cwd, "notes"), { recursive: true });
writeFileSync(
  join(cwd, "notes", "manual.txt"),
  "这是手动添加的工作区文件。\nThe snapshot stays with this conversation.",
);
writeFileSync(join(cwd, ".env"), "SYNTHETIC_SECRET_DO_NOT_SHOW=true");
const pdfFixture = process.env.ARTIFACT_PDF_FIXTURE === "1";
if (pdfFixture)
  writeFileSync(
    join(cwd, "oversized.pdf"),
    readFileSync(".data/pdf-fixtures/oversized.pdf"),
  );
const codex = new FakeCodex();
const original = codex.call.bind(codex);
let revision = 0;
codex.call = (async (method: any, params: any) => {
  const value = await original(method, params);
  if (method === "turn/start") {
    const current = ++revision;
    setTimeout(
      () => {
        const docs: Record<string, string | Buffer> =
          current > 1
            ? { "report.json": '{"version":2,"status":"updated"}' }
            : {
                "summary.md":
                  "# 项目交付说明\n\n文件预览已经准备就绪。\n\n| 模块 | 状态 |\n| --- | --- |\n| 聊天产物 | 已完成 |\n| 文件快照 | 已保存 |\n\n- 支持中文与表格\n- 历史版本保持不变\n\n<script>globalThis.ARTIFACT_XSS=true</script>\n\n![外部图片](https://example.com/should-not-load.png)",
                "example.ts":
                  'export function greet(name: string) {\n  return `你好，${name}`;\n}\n\nconsole.log(greet("Minimal Agent"));',
                "report.json":
                  '{"version":1,"status":"ready","items":["文本","代码","图片"]}',
                "metrics.csv":
                  '服务,CPU,备注\r\nweb,23%,"运行正常"\r\nworker,41%,"多行备注\n第二行"\r\n"data, api",12%,"带逗号的名称"',
                "page.html": `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:32px;font:16px/1.6 system-ui;color:#242424;background:#fff}h1{font-size:24px;margin:0 0 12px}button{font:inherit;min-height:44px;padding:8px 18px;border:1px solid #ccc;border-radius:10px;background:#f4f4f4}p{margin:12px 0}output{font-weight:600}</style></head><body><h1>交互页面测试</h1><p>这是独立 HTML 快照中的计数器。</p><button id="increment">增加一次</button><p>点击次数：<output id="count">0</output></p><script>globalThis.ARTIFACT_XSS=true;let count=0;document.querySelector('#increment').onclick=()=>document.querySelector('#count').textContent=String(++count);</script></body></html>`,
                "empty.txt": "",
                "large.txt":
                  "Large file preview\n" + "0123456789".repeat(20_000),
                "broken.json": '{"unfinished":',
                "pixel.png": Buffer.from(
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=",
                  "base64",
                ),
              };
        if (pdfFixture && current === 1)
          for (const name of [
            "preview",
            "range",
            "password",
            "broken",
            "many-pages",
          ])
            docs[`${name}.pdf`] = readFileSync(
              `.data/pdf-fixtures/${name}.pdf`,
            );
        for (const [name, data] of Object.entries(docs))
          writeFileSync(join(cwd, name), data);
        codex.item(
          params.threadId,
          value.turn.id,
          {
            id: `files-${current}`,
            type: "fileChange",
            status: "completed",
            changes: Object.keys(docs).map((path) => ({
              path,
              kind: { type: current > 1 ? "update" : "add", move_path: null },
              diff: "",
            })),
          },
          true,
        );
        codex.item(
          params.threadId,
          value.turn.id,
          {
            id: `answer-${current}`,
            type: "agentMessage",
            text:
              current > 1
                ? "已更新 report.json，原有快照保留。"
                : "文件已准备好，可以在下方查看或下载。此回复为浏览器测试夹具。",
          },
          true,
        );
        codex.finish(params.threadId);
      },
      process.env.ARTIFACT_LIFECYCLE_FIXTURE ? 600 : 100,
    );
  }
  return value;
}) as typeof codex.call;
const { app, artifacts } = await createServer({
    providerRuntime: null,
  directory,
  cwd,
  codex,
  password: "artifact-ui-test-password",
  origins: [`http://127.0.0.1:${port}`],
});
if (pdfFixture) {
  app.post("/api/test/pdf", async () => {
    const threadId = [...codex.threads.keys()][0];
    const turn = codex.threads.get(threadId)!.turns.at(-1);
    writeFileSync(
      join(cwd, "preview.pdf"),
      readFileSync(".data/pdf-fixtures/second-version.pdf"),
    );
    codex.item(
      threadId,
      turn.id,
      {
        id: "pdf-second-patch",
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "preview.pdf",
            kind: { type: "update", move_path: null },
            diff: "",
          },
        ],
      },
      true,
    );
    await artifacts.flush();
    return { ok: true };
  });
}
if (process.env.ARTIFACT_LIFECYCLE_FIXTURE) {
  const orphan = createHash("sha256")
    .update("old orphan test bytes")
    .digest("hex");
  writeFileSync(join(directory, "artifacts", orphan), "old orphan test bytes");
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  utimesSync(join(directory, "artifacts", orphan), old, old);
  let saved: { sha: string; data: Buffer } | undefined;
  app.post("/api/test/lifecycle", async (req) => {
    const action = (req.body as { action: string }).action;
    const threadId = [...codex.threads.keys()][0];
    const native = codex.threads.get(threadId)!;
    const turn = native.turns.at(-1);
    const first = artifacts
      .list(threadId)
      .find((a) => a.path === "report.json" && a.version === 1)!;
    if (action === "revise-json") {
      writeFileSync(
        join(cwd, "report.json"),
        '{"version":2,"status":"updated"}',
      );
      codex.item(
        threadId,
        turn.id,
        {
          id: "second-patch",
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "report.json",
              kind: { type: "update", move_path: null },
              diff: "",
            },
          ],
        },
        true,
      );
      await artifacts.flush();
      return { ok: true };
    }
    if (action === "revise-html") {
      writeFileSync(
        join(cwd, "page.html"),
        "<!doctype html><h1>HTML version two</h1><button>Ready</button>",
      );
      codex.item(
        threadId,
        turn.id,
        {
          id: "html-second",
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "page.html",
              kind: { type: "update", move_path: null },
              diff: "",
            },
          ],
        },
        true,
      );
      await artifacts.flush();
      return { ok: true };
    }
    if (action === "hide-snapshot") {
      saved = {
        sha: first.sha256,
        data: readFileSync(join(directory, "artifacts", first.sha256)),
      };
      unlinkSync(join(directory, "artifacts", first.sha256));
      return { ok: true };
    }
    if (action === "restore-snapshot" && saved) {
      writeFileSync(join(directory, "artifacts", saved.sha), saved.data);
      return { ok: true };
    }
    throw new Error("不支持的测试操作");
  });
}
await app.listen({ host: "127.0.0.1", port });
console.log(`Artifact UI fixture ready: http://127.0.0.1:${port}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
