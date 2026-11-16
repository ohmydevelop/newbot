import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { localOAuthProvider } from "../tests/local-oauth-provider";
import { createServer } from "../server/index";
import { Codex } from "../server/codex";
const output = resolve(process.env.UI_EVIDENCE_DIR || ".data/local-oauth");
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "newbot-local-oauth-")),
  home = join(root, "codex"),
  work = join(root, "work");
await mkdir(home);
await mkdir(work);
const provider = await localOAuthProvider();
await writeFile(
  join(home, "config.toml"),
  `model="gpt-6.1-sol"\n[mcp_servers.local_oauth]\nurl="${provider.origin}/mcp"\nenabled=true\n`,
);
const native = new Codex(work, () => ({ CODEX_HOME: home }));
let threadId = "";
const call = native.call.bind(native);
native.call = (async (method: any, params: any) => {
  if (method === "mcpServer/oauth/login" && params.threadId)
    threadId = params.threadId;
  const result = await call(method, params);
  return result;
}) as typeof native.call;
const origin = "http://127.0.0.1:3173";
const { app } = await createServer({
  directory: join(root, "app"),
  cwd: work,
  codex: native,
  providerRuntime: null,
  password: "local-oauth-fixture",
  origins: [origin],
});
let browser;
const result: any = {
  scope:
    "Local authorization server and protected MCP, real isolated Codex; no third-party login",
  checks: {},
};
try {
  await native.start();
  await app.listen({ host: "127.0.0.1", port: 3173 });
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    recordVideo: {
      dir: join(output, "video"),
      size: { width: 390, height: 844 },
    },
  });
  await context.request.post(origin + "/api/login", {
    data: { password: "local-oauth-fixture" },
    headers: { Origin: origin },
  });
  const action = async (action: string, params = {}) => {
    const r = await context.request.post(origin + "/api/agent/action", {
      data: { action, ...params },
      headers: { Origin: origin },
      timeout: 40000,
    });
    const data = await r.json();
    assert(r.ok(), JSON.stringify(data));
    return data;
  };
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(origin);
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page.getByRole("button", { name: "展开侧栏", exact: true }).tap();
  await page.getByRole("button", { name: "设置", exact: true }).tap();
  await page.getByRole("button", { name: "连接器", exact: true }).tap();
  await page
    .getByRole("button", { name: "查看 local_oauth", exact: true })
    .tap();
  const authorize = async () => {
    await page
      .getByRole("button", { name: "授权 local_oauth", exact: true })
      .tap();
    const link = page.getByRole("link", {
      name: "打开 local_oauth 授权页面",
      exact: true,
    });
    await link.waitFor();
    const popup = context.waitForEvent("page");
    await link.tap();
    const auth = await popup;
    await auth
      .getByRole("heading", { name: "本地 OAuth 验收", exact: true })
      .waitFor();
    return auth;
  };
  let auth = await authorize();
  await auth.getByRole("button", { name: "拒绝", exact: true }).tap();
  await expect(
    page.getByText("账号授权未完成，请重试。", { exact: true }),
  ).toBeVisible();
  result.checks.deniedRecoverable = true;
  await auth.close();
  auth = await authorize();
  await auth.screenshot({ path: join(output, "local-consent.png") });
  await auth.getByRole("button", { name: "允许测试访问", exact: true }).tap();
  await expect(
    page.getByRole("link", { name: "打开 local_oauth 授权页面", exact: true }),
  ).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".connection-tool")).toHaveCount(1, {
    timeout: 30000,
  });
  assert.equal(provider.counts.pkceVerified, 1);
  assert(provider.counts.toolsListed > 0);
  result.checks.authorizationAndDiscovery = true;
  await page.screenshot({ path: join(output, "local-connected.png") });
  await auth.close();
  if (!threadId) {
    const started = await native.call("thread/start", {
      cwd: work,
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    threadId = started.thread.id;
  }
  const answer = await native.call("mcpServer/tool/call", {
    threadId,
    server: "local_oauth",
    tool: "echo",
    arguments: { text: "UI15 local OAuth verified" },
  });
  assert.match(JSON.stringify(answer), /UI15 local OAuth verified/);
  result.checks.nativeToolCall = true;
  assert.equal(await provider.replayLastCode(), 400);
  result.checks.usedCodeRejected = true;
  provider.expireAccess();
  const second = await native.call("mcpServer/tool/call", {
    threadId,
    server: "local_oauth",
    tool: "echo",
    arguments: { text: "UI15 renewed" },
  });
  assert.match(JSON.stringify(second), /UI15 renewed/);
  assert(provider.counts.refreshed > 0);
  result.checks.expiredTokenRefresh = true;
  const listedBeforeRestart = provider.counts.toolsListed;
  await native.restart();
  const saved = await context.request
    .get(origin + "/api/config?view=saved")
    .then((r) => r.json());
  await action("mcp/test", {
    id: "local_oauth",
    expectedRevision:
      saved.configuration.revisions["mcp:local_oauth"] ||
      saved.configuration.revision,
  });
  assert(provider.counts.toolsListed > listedBeforeRestart);
  result.checks.restartDiscovery = true;
  const restarted = await native.call("thread/start", {
    cwd: work,
    approvalPolicy: "never",
    sandbox: "read-only",
  });
  const restored = await native.call("mcpServer/tool/call", {
    threadId: restarted.thread.id,
    server: "local_oauth",
    tool: "echo",
    arguments: { text: "UI15 after restart" },
  });
  assert.match(JSON.stringify(restored), /UI15 after restart/);
  result.checks.restartToolCall = true;
  await page.reload();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  result.checks.reload = true;
  result.counts = provider.counts;
  result.passed = true;
  await context.close();
} catch (error) {
  result.passed = false;
  result.error = error instanceof Error ? error.message : String(error);
  console.error(result.error);
  process.exitCode = 1;
} finally {
  result.counts = provider.counts;
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  await browser?.close();
  await app.close();
  native.stop();
  await provider.close();
  await rm(root, { recursive: true, force: true });
}
