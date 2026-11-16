import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { SMTPServer } from "smtp-server";
import { chromium, expect } from "@playwright/test";
import { Codex } from "../server/codex";
import { createServer } from "../server/index";
const root = process.env.AUTOMATION_STAGE_DIR;
if (!root)
  throw Error("AUTOMATION_STAGE_DIR must be an isolated production snapshot");
const output = resolve(
  process.env.AUTOMATION_EVIDENCE_DIR || ".data/automation-live",
);
await mkdir(output, { recursive: true });
const localMail = process.env.AUTOMATION_LOCAL_SMTP === "1";
const messages: string[] = [];
const origin = "http://127.0.0.1:3175";
let smtp: SMTPServer | undefined;
let smtpConfig: Record<string, unknown> | undefined;
if (localMail) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      join(root, "smtp-key"),
      "-out",
      join(root, "smtp-cert"),
    ],
    { stdio: "ignore" },
  );
  const ca = await readFile(join(root, "smtp-cert"), "utf8");
  smtp = new SMTPServer({
    secure: true,
    key: await readFile(join(root, "smtp-key")),
    cert: ca,
    logger: false,
    onAuth(auth, _session, callback) {
      callback(
        auth.username === "local-test" &&
          auth.password === "local-only-password"
          ? null
          : new Error("invalid login"),
        { user: "local-test" },
      );
    },
    onData(stream, _session, callback) {
      let text = "";
      stream.on("data", (chunk) => (text += chunk.toString()));
      stream.on("end", () => {
        messages.push(text);
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => smtp!.listen(0, "127.0.0.1", resolve));
  smtpConfig = {
    host: "127.0.0.1",
    port: (smtp.server.address() as any).port,
    secure: true,
    user: "local-test",
    from: "bot@example.test",
    to: "owner@example.test",
    baseUrl: origin,
    ca,
  };
}
let clock = Date.parse("2026-11-16T00:00:00Z");
const evidence: any = {
  scope: localMail
    ? "Isolated production snapshot; real model and local TLS SMTP, browser notification deep link; no external email or production changes"
    : "Isolated production snapshot with real configured model; no browser, no external email, no production task changes",
  checks: [],
};
async function start() {
  const native = new Codex(join(root!, "work"), () => ({
    CODEX_HOME: join(root!, "codex"),
    HOME: root!,
  }));
  const ctx = await createServer({
    directory: join(root!, "data"),
    cwd: join(root!, "work"),
    codex: native,
    password: "isolated-automation-test",
    origins: [origin],
    automationClock: () => clock,
    automationTimer: false,
  });
  try {
    await native.start();
    assert.equal(native.state, "ready", native.reason);
    return ctx;
  } catch (error) {
    await ctx.app.close();
    throw error;
  }
}
let ctx: Awaited<ReturnType<typeof start>> | undefined;
try {
  ctx = await start();
  if (localMail) {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "isolated-automation-test" },
      headers: { origin },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies.map((v) => `${v.name}=${v.value}`).join("; ");
    const save = await ctx.app.inject({
      method: "POST",
      url: "/api/automations/mail/save",
      headers: { origin, cookie },
      payload: {
        revision: 0,
        config: smtpConfig,
        password: "local-only-password",
      },
    });
    assert.equal(save.statusCode, 200);
    evidence.checks.push("smtp-config-saved-through-authenticated-http");
  }
  const input = {
    name: "自动任务真实模型验收",
    prompt: "只回复：自动任务验收通过。不要调用工具。",
    mode: "chat",
    notification: localMail ? "both" : "app",
    triggers: [
      {
        id: randomUUID(),
        frequency: "daily",
        time: "00:01",
        timezone: "UTC",
        date: "2026-11-16",
      },
    ],
  };
  const task = await ctx.automations.save({
    id: randomUUID(),
    expectedRevision: 0,
    content: input,
  });
  clock += 120000;
  await ctx.automations.tick();
  async function complete() {
    let run = ctx!.automations.read(task.id).runs[0];
    for (
      let i = 0;
      i < 180 &&
      ["running", "dispatching", "queued", "waiting"].includes(run.state);
      i++
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      await ctx!.automations.tick();
      run = ctx!.automations.result(run.id);
    }
    assert.equal(run.state, "succeeded", JSON.stringify(run));
    const t = await ctx!.service.read(run.threadId!);
    const answer = t.turns
      .flatMap((v) => v.items)
      .filter((v) => v.type === "agentMessage")
      .map((v: any) => v.text)
      .join("\n");
    assert.match(answer, /验收通过/);
    assert.equal(ctx!.service.runtimeSettings.get(run.threadId!).mode, "chat");
    if (localMail) {
      for (
        let i = 0;
        i < 100 && ctx!.automations.result(run.id).delivery?.state !== "sent";
        i++
      ) {
        await ctx!.automations.tick();
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(ctx!.automations.result(run.id).delivery?.state, "sent");
      assert.equal(
        messages.filter((text) => text.includes(`<${run.id}@newbot.local>`))
          .length,
        1,
      );
      assert.ok(
        messages.every((text) => !text.includes("local-only-password")),
      );
    }
    return {
      id: run.id,
      threadId: run.threadId,
      requestId: run.requestId,
      state: run.state,
    };
  }
  const scheduled = await complete();
  evidence.checks.push(
    "scheduled-without-browser-real-model",
    "chat-mode-preserved",
  );
  await ctx.app.close();
  ctx = await start();
  assert.equal(ctx.automations.read(task.id).runs.length, 1);
  assert.equal(ctx.automations.result(scheduled.id).state, "succeeded");
  await ctx.automations.tick();
  assert.equal(ctx.automations.read(task.id).runs.length, 1);
  evidence.checks.push("restart-preserves-task-and-result-without-replay");
  clock += 1000;
  ctx.automations.runNow(task.id, task.revision, randomUUID());
  await ctx.automations.tick();
  const manual = await complete();
  assert.notEqual(scheduled.threadId, manual.threadId);
  evidence.checks.push("run-now-new-independent-conversation");
  ctx.automations.control(task.id, task.revision, "pause");
  clock += 86400000;
  await ctx.automations.tick();
  assert.equal(ctx.automations.read(task.id).runs.length, 2);
  evidence.checks.push("paused-due-time-does-not-dispatch");
  if (localMail) {
    assert.equal(messages.length, 2);
    evidence.checks.push(
      "scheduled-result-local-tls-mail-delivered-once",
      "restart-retains-mail-config-and-does-not-resend",
      "manual-result-separate-mail",
    );
    await ctx.app.listen({ host: "127.0.0.1", port: 3175 });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const raw = messages.find((text) =>
        text.includes(`<${scheduled.id}@newbot.local>`),
      )!;
      const [headers, ...parts] = raw.split(/\r?\n\r?\n/);
      const encoded = parts.join("\r\n\r\n");
      const text = /Content-Transfer-Encoding: base64/i.test(headers)
        ? Buffer.from(encoded, "base64").toString("utf8")
        : encoded.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
      const link = text.match(
        /http:\/\/127\.0\.0\.1:3175\/\?automation=[a-f0-9-]+/,
      )?.[0];
      assert.ok(link, "Notification must contain the result link");
      await page.goto(link);
      await page.getByLabel("登录密码").fill("isolated-automation-test");
      await page.getByRole("button", { name: "继续", exact: true }).tap();
      await expect(
        page.getByText("自动任务验收通过。", { exact: true }),
      ).toBeVisible({ timeout: 30000 });
      assert.ok(!new URL(page.url()).searchParams.has("automation"));
      await page.getByRole("button", { name: "展开侧栏", exact: true }).tap();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: /^自动任务/ })
        .tap();
      await page
        .locator(".automation-row-copy")
        .filter({ hasText: input.name })
        .tap();
      await page.getByRole("tab", { name: "运行记录", exact: true }).tap();
      await expect(
        page.getByText("邮件已交付服务器", { exact: true }).first(),
      ).toBeVisible();
      await page.screenshot({ path: join(output, "mail-result-mobile.png") });
      evidence.checks.push(
        "email-link-survives-login-and-opens-real-chat-then-run-history-mobile",
      );
    } finally {
      await browser.close();
    }
  }
  evidence.runs = [scheduled, manual];
  evidence.passed = true;
} catch (e) {
  evidence.passed = false;
  evidence.error = e instanceof Error ? e.message : "failed";
  throw e;
} finally {
  await writeFile(
    join(output, "native-live.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await ctx?.app.close();
  if (smtp) await new Promise<void>((resolve) => smtp!.close(resolve));
}
console.log(JSON.stringify(evidence));
