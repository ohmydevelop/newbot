// Analysis probe only. Serves the existing dist build with an isolated fake runtime.
// No paid provider, live configuration, personal Codex home or product source is changed.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve('.issue/2026-11-10/evidence-issue-04');
mkdirSync(output, { recursive: true });
const origin = 'http://127.0.0.1:3157';
const server = spawn(process.execPath, ['--import', 'tsx', 'tests/issue-preview-server.ts'], {
  env: { ...process.env, NODE_ENV: 'test', AGENT_TRANSPORT: 'poll', ISSUE_TEST_PORT: '3157', ISSUE_RICH_UI: '1', ISSUE_MEMORY_PROVIDERS: '1', ISSUE_ACTIVITY_UI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = new Promise(r => server.once('exit', r));
let browser, page, log = '';
const report = { at: new Date().toISOString(), environment: 'Chromium, existing dist/web, isolated IssueCodex fixture', layouts: [], errors: [] };
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(log)), 15000);
    const collect = chunk => { log += chunk; if (log.includes('Issue UI fixture ready')) { clearTimeout(timeout); resolve(); } };
    server.stdout.on('data', collect); server.stderr.on('data', collect);
    server.once('exit', () => { clearTimeout(timeout); reject(Error(log)); });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar,FluentOverlayScrollbar'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const post = async (path, data) => {
    const r = await context.request.post(origin + path, { headers: { origin }, data });
    return { status: r.status(), body: await r.json() };
  };
  const action = (action, data = {}) => post('/api/agent/action', { action, ...data });
  await post('/api/login', { password: 'issue-fixture-login' });
  const run = await post('/api/agent/run', { requestId: crypto.randomUUID(), text: 'Issue 04 investigation', provider: 'fixture', model: 'fixture-model' });
  if (run.status !== 200) throw Error(JSON.stringify(run));
  const threadId = run.body.threadId;
  await action('thread/name/set', { threadId, name: 'Issue 04 investigation' });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(origin);
  await page.locator('.history-link').filter({ hasText: 'Issue 04 investigation' }).click();
  await page.getByRole('button', { name: '停止回答', exact: true }).waitFor();
  report.runningControls = await page.locator('.runtime-picker-trigger, .approval-trigger, .skill-picker-trigger').evaluateAll(els => els.map(el => ({ label: el.getAttribute('aria-label'), disabled: el.disabled })));
  report.runningUpdate = await action('session/update', { threadId, expectedRevision: 0, effort: 'medium' });
  await post('/api/test/activity', { threadId, state: 'waiting' });
  await page.locator('.thread-status.status-waiting').waitFor();
  report.waiting = await page.evaluate(() => ({ label: document.querySelector('.thread-status.status-waiting')?.getAttribute('aria-label'), process: document.querySelector('.process-toggle')?.innerText, approvalVisible: !!document.querySelector('.approval-card'), statusText: document.querySelector('.thread-status.status-waiting')?.textContent }));
  await page.screenshot({ path: resolve(output, 'waiting-light.png') });
  await post('/api/test/activity', { threadId, state: 'running' });
  await page.getByRole('button', { name: '停止回答', exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.process-toggle').click();
  const summary = page.locator('.tool-item > summary').filter({ hasText: '执行命令' });
  await summary.waitFor();
  const measure = () => page.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(); return { x: r.x, width: r.width, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; };
    return { conversation: box('.conversation'), column: box('.message-column'), composer: box('.composer'), main: box('.main'), gutter: getComputedStyle(document.querySelector('.conversation')).scrollbarGutter };
  });
  for (const width of [1366, 1000, 390]) {
    for (const height of [400, 450, 500, 550, 650, 800]) {
      await page.setViewportSize({ width, height });
      const before = await measure(); await summary.click(); const after = await measure();
      report.layouts.push({ width, height, before, after });
      if (before.column.x !== after.column.x || before.column.width !== after.column.width) {
        await page.screenshot({ path: resolve(output, `layout-${width}-${height}-expanded.png`) });
        await summary.click(); await page.screenshot({ path: resolve(output, `layout-${width}-${height}-collapsed.png`) });
      } else await summary.click();
    }
  }
  // Temporary page-only counterfactual, explicitly not an implementation.
  const shifted = report.layouts.find(v => v.before.column.x !== v.after.column.x || v.before.column.width !== v.after.column.width);
  await page.setViewportSize(shifted ? { width: shifted.width, height: shifted.height } : { width: 1000, height: 500 });
  const stable = await page.addStyleTag({ content: '.conversation { scrollbar-gutter: stable; }' });
  const before = await measure(); await summary.click(); const after = await measure();
  report.gutterCounterfactual = { before, after }; await summary.click(); await stable.evaluate(el => el.remove());
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: '选择模型与推理强度', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索网关或模型' });
  await search.waitFor();
  report.search = await search.evaluate(el => ({ focused: document.activeElement === el, focusVisible: el.matches(':focus-visible'), border: getComputedStyle(el).border, outline: getComputedStyle(el).outline, outlineOffset: getComputedStyle(el).outlineOffset }));
  await page.screenshot({ path: resolve(output, 'search-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: resolve(output, 'search-dark.png') });
  await page.keyboard.press('Escape');
  const account = page.getByRole('button', { name: '个人工作台 私有实例' });
  if (!(await account.isVisible())) await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await account.click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '模型网关', exact: true }).click();
  await settings.locator('.gateway-card select option[value="fixture-model"]').first().waitFor({ state: 'attached' });
  report.gateway = await settings.locator('.gateway-card').evaluateAll(els => els.map(el => {
    const select = el.querySelector('select'); const del = el.querySelector('button[aria-label^="删除"]'); const edit = el.querySelector('button[aria-label^="编辑"]');
    return { check: !!el.querySelector('.gateway-check'), selected: el.querySelector('.gateway-select').getAttribute('aria-pressed'), appearance: getComputedStyle(select).appearance, paddingRight: getComputedStyle(select).paddingRight, deleteColor: getComputedStyle(del).color, editColor: getComputedStyle(edit).color };
  }));
  await page.screenshot({ path: resolve(output, 'gateways-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' }); await page.screenshot({ path: resolve(output, 'gateways-light.png') });
  const thread = await (await context.request.get(origin + '/api/threads/' + threadId)).json();
  report.unknownEffort = await action('session/update', { threadId, expectedRevision: thread.runtime.revision, provider: 'fixture', model: 'secondary-model', effort: 'low' });
} catch (e) {
  report.failure = String(e.stack || e); if (page) await page.screenshot({ path: resolve(output, 'probe-failure.png') }).catch(() => {}); process.exitCode = 1;
} finally {
  await browser?.close(); server.kill('SIGTERM'); await exited;
  writeFileSync(resolve(output, 'ui.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ failure: report.failure, runningControls: report.runningControls, runningUpdate: report.runningUpdate, waiting: report.waiting, search: report.search, gateway: report.gateway, unknownEffort: report.unknownEffort, shifts: report.layouts.filter(v => v.before.column.x !== v.after.column.x || v.before.column.width !== v.after.column.width).map(v => ({ width: v.width, height: v.height, before: v.before.column, after: v.after.column })), errors: report.errors }, null, 2));
}
