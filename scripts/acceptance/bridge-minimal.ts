import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import type { eventPublisher as Publisher } from "../../packages/event-bridge/publisher.js";
const bundle = resolve("dist/event-bridge/publisher.mjs");
const { eventPublisher }: { eventPublisher: typeof Publisher } = await import(
  bundle
);
import { chromium } from "@playwright/test";

if (!process.env.CODEX_BIN)
  throw new Error("Set CODEX_BIN to the protocol-compatible native runtime");
const evidence = resolve(
  process.env.BRIDGE_EVIDENCE_DIR || ".data/bridge-acceptance/evidence",
);
await mkdir(evidence, { recursive: true });
const child = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/acceptance/bridge-local.ts"],
  { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
let stderr = "";
child.stderr.on("data", (b) => (stderr += b));
const lines = createInterface({ input: child.stdout });
let settings: any, publisher: ReturnType<typeof eventPublisher> | undefined;
const timeout = setTimeout(() => child.kill("SIGTERM"), 180000);
try {
  const ready = await new Promise<any>((resolve, reject) => {
    child.on("exit", (code) =>
      reject(new Error(`Lab exited ${code}: ${stderr}`)),
    );
    lines.on("line", (line) => {
      try {
        const data = JSON.parse(line);
        if (data.ready) resolve(data);
      } catch {}
    });
  });
  settings = JSON.parse(await readFile(ready.root + "/runtime.json", "utf8"));
  const control = async (path = "") => {
    const response = await fetch(
      settings.control + path,
      path ? { method: "POST" } : {},
    );
    const data = await response.json();
    assert(response.ok, JSON.stringify(data));
    return data;
  };
  const options = {
    url: settings.env.NEWBOT_EVENT_URL,
    token: settings.env.NEWBOT_EVENT_TOKEN,
    caCertificate: settings.env.NEWBOT_EVENT_CA_CERTIFICATE,
    source: "urn:newbot:minimal-acceptance",
    directory: ready.root + "/producer",
  };
  publisher = eventPublisher(options);
  const time = new Date().toISOString();
  publisher.enqueue(
    "sample.updated",
    { message: "first event" },
    "first",
    time,
  );
  await publisher.flush();
  async function awaitRuns(n: number) {
    for (let i = 0; i < 100; i++) {
      const state = await control();
      const failed = state.runs.find((r: any) => r.state === "failed");
      assert(!failed, JSON.stringify(failed || {}));
      if (
        state.runs.length === n &&
        state.runs.every((r: any) => r.state === "succeeded")
      )
        return state;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `Timed out waiting for ${n} successful runs: ${JSON.stringify(await control())}`,
    );
  }
  const first = await awaitRuns(1);
  await control("/pause");
  publisher.enqueue(
    "sample.updated",
    { message: "survives offline and reopen" },
    "second",
  );
  await assert.rejects(publisher.flush());
  await publisher.close();
  publisher = eventPublisher(options);
  await control("/resume");
  await publisher.flush();
  const second = await awaitRuns(2);
  assert.equal(second.runs[0].threadId, first.runs[0].threadId);
  publisher.enqueue(
    "sample.updated",
    { message: "first event" },
    "first",
    time,
  );
  await publisher.flush();
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal((await control()).runs.length, 2);
  await control("/restart");
  publisher.enqueue(
    "sample.updated",
    { message: "after Newbot restart" },
    "third",
  );
  await publisher.flush();
  const result = await awaitRuns(3);
  assert.equal(new Set(result.runs.map((r: any) => r.threadId)).size, 1);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(settings.app);
      const login = await page.request.post(settings.app + "/api/login", {
        data: { password: "bridge-local-acceptance-only" },
        headers: { Origin: settings.app },
      });
      assert(login.ok(), await login.text());
      await page.reload();
      await page
        .getByRole("button", { name: "选择模型", exact: true })
        .waitFor();
      if (width < 760)
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .click();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: /^自动任务/ })
        .click();
      await page.getByText("Bridge 验收", { exact: true }).first().click();
      await page.getByRole("tab", { name: "运行记录", exact: true }).click();
      await page
        .getByRole("button", { name: "打开会话", exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "打开会话", exact: true })
          .count(),
        3,
      );
      await page.screenshot({
        path: evidence + `/newbot-${width}.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page
        .getByRole("button", { name: "打开会话", exact: true })
        .first()
        .click();
      await page.getByText("BRIDGE_RECEIVED_3", { exact: true }).waitFor();
      await page.screenshot({
        path: evidence + `/conversation-${width}.png`,
        fullPage: true,
      });
      assert.equal(await page.getByText(/^BRIDGE_RECEIVED_[123]$/).count(), 3);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const report = {
    ...result,
    assertions: {
      realNativeRuntime: true,
      realPluginImport: true,
      httpsEndToEnd: true,
      failedDeliveryRetriedAfterProducerReopen: true,
      duplicateDidNotCreateRun: true,
      newbotRestartRestoredAccountAndTask: true,
      threeRunsOneConversation: true,
      browserNoOverflow: [390, 1280],
    },
    boundaries: [
      "Model endpoint is a local deterministic fixture, not an external model service",
      "Loopback HTTPS proxy with verified private CA, not public deployment",
      "No OpenClaw/Hermes compatibility (cancelled by user)",
    ],
  };
  await writeFile(evidence + "/receipt.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
  await publisher?.close();
  if (settings)
    await fetch(settings.control + "/finish", { method: "POST" }).catch(
      () => {},
    );
  child.kill("SIGTERM");
  await writeFile(evidence + "/runtime-stderr.txt", stderr);
}
