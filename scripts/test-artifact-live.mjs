// Opt-in development smoke: one real Codex turn in a temporary workspace.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "../dist/server/index.js";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const htmlTest = process.env.ARTIFACT_LIVE_HTML === "1";
const fileName = htmlTest ? "browser-proof.html" : "browser-proof.md";
const expected = htmlTest
  ? '<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;padding:32px}button{padding:12px 20px}</style></head><body><h1>Live HTML proof</h1><button id="add">Add</button><output id="count">0</output><script>let count=0;document.querySelector("#add").onclick=()=>document.querySelector("#count").textContent=String(++count);</script></body></html>\n'
  : "# Live artifact proof\n\nCreated by the real Codex runtime.\n";
const directory = mkdtempSync(join(tmpdir(), "newbot-artifact-live-"));
const output = resolve(
  htmlTest ? ".data/artifact-live-html" : ".data/artifact-live",
);
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(join(output, name), { force: true });
const password = randomBytes(24).toString("base64url");
const app = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "workspace"),
  password,
  origins: ["http://127.0.0.1:3103"],
});
let browser;
let page;
let runFailure;
let threadId;
const methods = new Set();
app.runtime.on("event", (event) => methods.add(event.method));
// This smoke never approves additional privileges or external service access.
app.runtime.on(
  "approval",
  (request) =>
    void app.service
      .handle("approval/respond", { id: request.id, allow: false })
      .catch(() => {}),
);
try {
  await app.app.listen({ host: "127.0.0.1", port: 3103 });
  await app.runtime.start();
  assert.equal(app.runtime.state, "ready");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const failedRun = new Promise((_, reject) => {
    page.on("response", async (response) => {
      if (
        response.url().endsWith("/api/agent/run") &&
        response.status() >= 400
      ) {
        runFailure = await response
          .json()
          .catch(() => ({ error: "Run failed" }));
        reject(new Error(`Run rejected: ${runFailure.error}`));
      }
    });
  });
  // Attach a handler before dispatch; the race below still observes the rejection.
  failedRun.catch(() => {});
  await page.goto("http://127.0.0.1:3103");
  await page.getByLabel("登录密码").fill(password);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page
    .getByPlaceholder("询问任何问题")
    .fill(
      `Use apply_patch to create ${fileName} in the current workspace, containing exactly this JSON-encoded string (decode the escapes): ${JSON.stringify(expected)}. Do not read other files, run shell commands, load skills, access the network or call MCP tools. Reply briefly when done.`,
    );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  console.log("Waiting for a real Codex fileChange and its chat card...");
  await Promise.race([
    failedRun,
    page
      .getByRole("button", {
        name: `查看 ${fileName}，版本 1`,
        exact: true,
      })
      .waitFor({ timeout: 90000 }),
  ]);
  await page
    .getByRole("button", { name: `查看 ${fileName}，版本 1`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  if (htmlTest) {
    const inner = page
      .frameLocator(`iframe[title="${fileName} 隔离预览"]`)
      .frameLocator('iframe[title="HTML page"]');
    await inner
      .getByRole("heading", { name: "Live HTML proof", exact: true })
      .waitFor();
    await inner.getByRole("button", { name: "Add", exact: true }).click();
    assert.equal(await inner.locator("#count").textContent(), "1");
  } else
    await dialog
      .getByRole("heading", { name: "Live artifact proof", exact: true })
      .waitFor();
  await page.screenshot({
    animations: "disabled",
    path: join(output, "real-codex-preview.png"),
  });
  const evidence = await page.evaluate(async (fileName) => {
    const threads = await (await fetch("/api/threads")).json();
    const response = await fetch(`/api/threads/${threads[0].id}/artifacts`);
    const { artifacts } = await response.json();
    const artifact = artifacts.find((a) => a.name === fileName);
    return {
      threadId: threads[0].id,
      artifact,
      content: await (await fetch(artifact.contentUrl)).text(),
    };
  }, fileName);
  threadId = evidence.threadId;
  assert.equal(evidence.artifact.source, "fileChange");
  assert.ok(evidence.artifact.itemId);
  assert.equal(evidence.content, expected);
  assert.equal(
    evidence.artifact.sha256,
    createHash("sha256").update(evidence.content).digest("hex"),
  );
  await page.reload();
  await page
    .getByRole("button", { name: `查看 ${fileName}，版本 1`, exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        ...evidence,
        nativeEvents: [...methods],
        pageErrors: errors,
        refreshed: true,
        interactiveHtml: htmlTest,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "PASS real Codex -> fileChange -> immutable snapshot -> Web preview -> reload",
  );
} catch (e) {
  if (page)
    await page
      .screenshot({ animations: "disabled", path: join(output, "failure.png") })
      .catch(() => {});
  writeFileSync(
    join(output, "failure.json"),
    JSON.stringify(
      {
        error: String(e),
        runtime: app.runtime.state,
        runFailure,
        nativeEvents: [...methods],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  throw e;
} finally {
  if (browser) await browser.close();
  if (threadId && !app.runtime.active.size)
    await app.service.handle("thread/archive", { threadId }).catch(() => {});
  await app.app.close();
  rmSync(directory, { recursive: true, force: true });
}
