// Browser regression for feedback layout. Codex/providers are isolated local fixtures.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, extname } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const stage = "workspaces";
const output = resolve(
  process.env.UI_EVIDENCE_DIR || ".issue/2026-11-10/evidence-issue-03/ui",
  stage,
);
const candidate = resolve(
  process.env.UI_TEST_CANDIDATE || ".data/issue-03-web",
);
mkdirSync(output, { recursive: true });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const origin = "http://127.0.0.1:3151";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/issue-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      ISSUE_TEST_PORT: "3151",
      ISSUE_RICH_UI: "1",
      ISSUE_MEMORY_PROVIDERS: "1",
      ISSUE_WORKSPACE_UI: "1",
      ...(stage === "navigation" ? { ISSUE_FEEDBACK_HISTORY: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page,
  current = "startup";
const checks = [],
  errors = [],
  metrics = [];
const exited = new Promise((resolve) => server.once("exit", resolve));
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(log)), 15000);
  const collect = (data) => {
    log += data;
    if (log.includes("Issue UI fixture ready")) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", () => {
    clearTimeout(timer);
    reject(Error(log));
  });
});
const check = async (name, run) => {
  current = name;
  await run();
  checks.push(name);
  console.log("PASS " + name);
};
const stable = (before, after, label) => {
  for (const key of ["x", "y", "width", "height"])
    assert.ok(
      Math.abs(before[key] - after[key]) <= 1,
      `${label}.${key}: ${before[key]} -> ${after[key]}`,
    );
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === origin &&
      route.request().method() === "GET" &&
      !url.pathname.startsWith("/api/")
    ) {
      const file = resolve(
        candidate,
        url.pathname === "/"
          ? "index.html"
          : "." + decodeURIComponent(url.pathname),
      );
      if (file.startsWith(candidate + "/") && existsSync(file))
        return route.fulfill({
          body: readFileSync(file),
          contentType:
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".wasm": "application/wasm",
            }[extname(file)] || "application/octet-stream",
        });
    }
    return route.continue();
  });
  const action = async (name, params = {}) => {
    const r = await context.request.post(origin + "/api/agent/action", {
      headers: { origin },
      data: { action: name, ...params },
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  await context.request.post(origin + "/api/login", {
    headers: { origin },
    data: { password: "issue-fixture-login" },
  });
  const threads = [];
  for (const title of ["Alpha History", "Beta Chat"]) {
    const response = await context.request.post(origin + "/api/agent/run", {
      headers: { origin },
      data: {
        requestId: crypto.randomUUID(),
        text: title,
        provider: "fixture",
        model: "fixture-model",
      },
    });
    assert.equal(response.status(), 200, await response.text());
    const run = await response.json();
    for (let i = 0; i < 50; i++) {
      const thread = await (
        await context.request.get(origin + "/api/threads/" + run.threadId)
      ).json();
      if (!thread.turns.some((t) => t.status === "inProgress")) break;
      if (i === 49) throw Error("Fixture turn did not finish");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await action("thread/name/set", { threadId: run.threadId, name: title });
    threads.push(run.threadId);
  }
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page
    .locator(".history-link")
    .getByText("Alpha History", { exact: true })
    .waitFor();
  await check(
    "workspace picker and previews stay bound to the active conversation",
    async () => {
      for (const [i, label] of [
        [0, "A"],
        [1, "B"],
      ]) {
        const seeded = await context.request.post(
          origin + "/api/test/workspace",
          { headers: { origin }, data: { threadId: threads[i], label } },
        );
        assert.equal(seeded.status(), 200);
        await page
          .locator(`[data-thread-id="${threads[i]}"] .history-link`)
          .click();
        await page.locator(".process-toggle").waitFor();
        await page
          .getByRole("button", { name: "添加附件", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "添加工作区文件", exact: true })
          .click();
        const picker = page.getByRole("dialog", {
          name: "添加工作区文件",
          exact: true,
        });
        await picker
          .getByRole("button", { name: "same.txt", exact: true })
          .waitFor();
        assert.equal(
          await picker
            .getByRole("button", {
              name: i === 0 ? "only-b.txt" : "only-a.txt",
              exact: true,
            })
            .count(),
          0,
        );
        await picker
          .getByRole("button", {
            name: i === 0 ? "only-a.txt" : "only-b.txt",
            exact: true,
          })
          .waitFor();
        await picker.screenshot({
          path: resolve(output, `workspace-${label}.png`),
        });
        await picker
          .getByRole("button", { name: "same.txt", exact: true })
          .click();
        await picker
          .getByRole("button", { name: "添加到本轮对话", exact: true })
          .click();
        await picker.waitFor({ state: "hidden" });
        await page
          .getByRole("button", { name: "查看 same.txt，版本 1", exact: true })
          .click();
        const preview = page.getByRole("dialog", {
          name: "same.txt",
          exact: true,
        });
        await preview
          .getByText("Workspace " + label, { exact: true })
          .waitFor();
        await preview.screenshot({
          path: resolve(output, `preview-${label}.png`),
        });
        await preview
          .getByRole("button", { name: "关闭", exact: true })
          .click();
      }
    },
  );
  await check(
    "refresh restores the correct file snapshot and mobile workspace picker stays within viewport",
    async () => {
      await page.reload();
      await page
        .locator(`[data-thread-id="${threads[1]}"] .history-link`)
        .click();
      await page
        .getByRole("button", { name: "查看 same.txt，版本 1", exact: true })
        .click();
      const preview = page.getByRole("dialog", {
        name: "same.txt",
        exact: true,
      });
      await preview.getByText("Workspace B", { exact: true }).waitFor();
      await preview.getByRole("button", { name: "关闭", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "添加附件", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "添加工作区文件", exact: true })
        .click();
      const picker = page.getByRole("dialog", {
        name: "添加工作区文件",
        exact: true,
      });
      await picker
        .getByRole("button", { name: "same.txt", exact: true })
        .waitFor();
      const b = await picker.boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= 390);
      await picker.screenshot({
        path: resolve(output, "workspace-mobile.png"),
      });
    },
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify({ fixture: true, stage, checks, metrics, errors }, null, 2) +
      "\n",
  );
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      { current, error: String(error), stack: error.stack, checks, errors },
      null,
      2,
    ),
  );
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
}
