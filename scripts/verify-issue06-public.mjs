import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    "/home/a/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);
const directory = resolve(".issue/2026-11-10/evidence-issue-06/S4/service");
await mkdir(directory, { recursive: true });
const { url, appOrigin } = JSON.parse(
  await readFile(".data/public-share.json", "utf8"),
);
const password = (await readFile(".data/initial-password", "utf8")).trim();
const disk = await readFile("dist/web/index.html", "utf8"),
  asset = /src="([^"]+\.js)"/.exec(disk)[1];
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const login = await context.request.post(url + "/api/login", {
    headers: { origin: url },
    data: { password },
    timeout: 30000,
  });
  assert.equal(login.status(), 200);
  const capabilities = await (
    await context.request.get(url + "/api/runtime/capabilities")
  ).json();
  assert.equal(capabilities.version, "codex-cli 0.165.0");
  assert.equal(capabilities.capabilities.a2ui.catalog, "newbot:ui/v2");
  assert.equal(capabilities.capabilities.a2ui.components, 10);
  assert.equal(capabilities.capabilities.imports.available, true);
  const html = await (
    await context.request.get(url + "/?issue06=" + Date.now())
  ).text();
  assert.equal(html, disk);
  assert.equal((await context.request.get(url + asset)).status(), 200);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "扩展", exact: true })
    .click();
  await page.getByRole("tab", { name: "技能", exact: true }).click();
  await page.getByRole("button", { name: "添加技能", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加技能", exact: true });
  for (const label of ["本地目录", "ZIP 文件", "GitHub"])
    assert.equal(
      await dialog
        .getByRole("button", { name: label, exact: true })
        .isVisible(),
      true,
    );
  await page.screenshot({
    path: resolve(directory, "public-import-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  assert.ok(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await page.screenshot({
    path: resolve(directory, "public-import-mobile.png"),
  });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "连接器", exact: true }).click();
  await page.getByRole("button", { name: "添加连接器", exact: true }).click();
  const connector = page.getByRole("dialog", {
    name: "添加连接器",
    exact: true,
  });
  await connector.getByLabel("连接器名称", { exact: true }).waitFor();
  const addArgument = connector.getByRole("button", { name: "添加参数", exact: true });
  assert.ok(await addArgument.evaluate(el => {
    const icon=el.querySelector("svg").getBoundingClientRect();
    const text=[...el.childNodes].find(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim());
    const range=document.createRange(); range.selectNodeContents(text);
    const label=range.getBoundingClientRect();
    return Math.abs(icon.y+icon.height/2-label.y-label.height/2)<3 && label.x-icon.right<12;
  }), "Argument action icon and label should stay on the same line");
  await page.screenshot({
    path: resolve(directory, "public-connector-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await connector.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await page.screenshot({
    path: resolve(directory, "public-connector-mobile.png"),
  });
  await connector.getByRole("button", { name: "关闭", exact: true }).click();
  assert.deepEqual(errors, []);
  const result = {
    at: new Date().toISOString(),
    url,
    appOrigin,
    asset,
    catalog: capabilities.capabilities.a2ui.catalog,
    components: capabilities.capabilities.a2ui.components,
    imports: true,
    publicHtmlMatchesDisk: true,
    desktopMobile: true,
    errors,
    modelTurnsCreated: 0,
  };
  await writeFile(
    resolve(directory, "public-verification.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
