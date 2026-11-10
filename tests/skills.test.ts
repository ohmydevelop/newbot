import { createElement } from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { skillLibrary, skillId, MAX_SKILL_BYTES } from "../server/skills.js";
import { skillMarkdown } from "../shared/skills.js";
import { SkillsCodex, skillSource } from "./skill-fixture.js";
import { createServer } from "../server/index.js";
import { Renderer } from "../web/components/Renderer.js";
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "newbot-skills-"));
  const codex = new SkillsCodex(directory);
  const cwd = join(directory, "workspace");
  mkdirSync(cwd);
  const library = skillLibrary(codex, cwd);
  return {
    directory,
    codex,
    cwd,
    library,
    clean: () => rmSync(directory, { recursive: true, force: true }),
  };
}
test("discovered skill IDs are stable, deduplicated and preserve native metadata; disabled skills remain readable without writes", async () => {
  const c = setup();
  try {
    c.codex.skills.push(c.codex.skills[0]);
    const result = await c.library.list();
    assert.equal(result.skills.length, 7);
    const first = result.skills[0];
    assert.equal(first.id, skillId(first.path));
    assert.equal(first.interface?.displayName, "代码审查");
    const read = await c.library.read(first.id);
    assert.equal(read.content, skillSource);
    assert.equal(read.size, Buffer.byteLength(skillSource));
    assert.equal(
      read.sha256,
      createHash("sha256").update(skillSource).digest("hex"),
    );
    const disabled = await c.library.read(result.skills[1].id);
    assert.equal(disabled.skill.enabled, false);
    assert.ok(
      !c.codex.calls.some((call) => call.method === "skills/config/write"),
    );
    for (const call of c.codex.calls.filter(
      (call) => call.method === "skills/list",
    ))
      assert.deepEqual(call.params, { cwds: [c.cwd], forceReload: true });
  } finally {
    c.clean();
  }
});
test("each read rediscovers current skills, refuses stale or forged IDs and reports native discovery failure without exposing upstream errors", async () => {
  const c = setup();
  try {
    const skill = (await c.library.list()).skills[0];
    writeFileSync(skill.path, "# Revised instruction");
    assert.equal(
      (await c.library.read(skill.id)).content,
      "# Revised instruction",
    );
    c.codex.skills = c.codex.skills.filter((s) => s.path !== skill.path);
    await assert.rejects(c.library.read(skill.id), { statusCode: 404 });
    await assert.rejects(
      c.library.read(skillId(join(c.directory, "unlisted-secret.txt"))),
      { statusCode: 404 },
    );
    await assert.rejects(c.library.read("../../etc/passwd"), {
      statusCode: 400,
    });
    c.codex.discoveryFailure = true;
    await assert.rejects(
      c.library.read(skill.id),
      (e: any) =>
        e.statusCode === 503 &&
        !e.message.includes("SYNTHETIC") &&
        !e.message.includes("private"),
    );
    c.codex.state = "offline";
    await assert.rejects(c.library.list(), { statusCode: 503 });
  } finally {
    c.clean();
  }
});
test("skill viewing rejects file and ancestor symlinks, hard links, directories and nonlocal/non-SKILL paths", async () => {
  const c = setup();
  try {
    const base = { ...c.codex.skills[0] };
    const rejectPath = async (path: string) => {
      c.codex.skills = [{ ...base, path }];
      await assert.rejects(c.library.read(skillId(path)), { statusCode: 403 });
    };
    await rejectPath(
      c.codex.skills.find((s) => s.name === "linked-skill")!.path,
    );
    const parentLink = join(c.directory, "alias");
    symlinkSync(join(c.directory, "skills", "code-review"), parentLink);
    await rejectPath(join(parentLink, "SKILL.md"));
    const hardDir = join(c.directory, "hard");
    mkdirSync(hardDir);
    linkSync(base.path, join(hardDir, "SKILL.md"));
    await rejectPath(join(hardDir, "SKILL.md"));
    const folder = join(c.directory, "folder", "SKILL.md");
    mkdirSync(folder, { recursive: true });
    await rejectPath(folder);
    await rejectPath("skill://remote/provider/example");
    await rejectPath("SKILL.md");
    await rejectPath(join(c.directory, "unlisted-secret.txt"));
  } finally {
    c.clean();
  }
});
test("skill reads are bounded, UTF-8 text only, allow empty files and report deleted files without a filesystem path", async () => {
  const c = setup();
  try {
    const skills = (await c.library.list()).skills;
    assert.equal(
      (await c.library.read(skills.find((s) => s.name === "empty-skill")!.id))
        .content,
      "",
    );
    await assert.rejects(
      c.library.read(skills.find((s) => s.name === "oversized-skill")!.id),
      { statusCode: 413 },
    );
    await assert.rejects(
      c.library.read(skills.find((s) => s.name === "invalid-skill")!.id),
      { statusCode: 415 },
    );
    const first = skills[0];
    writeFileSync(first.path, "a".repeat(MAX_SKILL_BYTES));
    assert.equal((await c.library.read(first.id)).size, MAX_SKILL_BYTES);
    writeFileSync(first.path, "text\0binary");
    await assert.rejects(c.library.read(first.id), { statusCode: 415 });
    unlinkSync(first.path);
    await assert.rejects(
      c.library.read(first.id),
      (e: any) => e.statusCode === 410 && !e.message.includes(c.directory),
    );
  } finally {
    c.clean();
  }
});
test("skill HTTP endpoint enforces session and origin boundaries, ignores arbitrary paths and exposes actual capabilities and discovery warnings", async () => {
  const c = setup();
  const origin = "http://127.0.0.1:3100";
  const ctx = await createServer({
    providerRuntime: null,
    directory: join(c.directory, "app"),
    cwd: c.cwd,
    codex: c.codex,
    password: "skill-test-password-only",
    origins: [origin],
  });
  try {
    const skill = (await c.library.list()).skills[0];
    const url = `/api/skills/${skill.id}`;
    assert.equal((await ctx.app.inject({ url })).statusCode, 401);
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "skill-test-password-only" },
    });
    const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
    const headers = { cookie, origin };
    const response = await ctx.app.inject({
      url: url + "?path=/etc/passwd",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().content, skillSource);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(
      (
        await ctx.app.inject({
          url,
          headers: { cookie, origin: "https://evil.example" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await ctx.app.inject({
          url,
          headers: { cookie, host: "localhost:3100" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await ctx.app.inject({ url: "/api/skills/invalid", headers }))
        .statusCode,
      400,
    );
    const capabilities = (
      await ctx.app.inject({ url: "/api/runtime/capabilities", headers })
    ).json();
    assert.deepEqual(capabilities.capabilities.skillDocuments, {
      read: true,
      maxBytes: MAX_SKILL_BYTES,
    });
    c.codex.warnings = true;
    const config = (
      await ctx.app.inject({ url: "/api/config", headers })
    ).json();
    assert.equal(config.skillsWarnings, 1);
    assert.equal(config.skills[0].id, skill.id);
    assert.ok(!JSON.stringify(config).includes("private native error"));
    c.codex.discoveryFailure = true;
    const failed = await ctx.app.inject({ url, headers });
    assert.equal(failed.statusCode, 503);
    assert.ok(!failed.body.includes("SYNTHETIC"));
  } finally {
    await ctx.app.close();
    c.clean();
  }
});
test("formatted skill content treats instructions as inert Markdown while preserving exact source and refusing embedded resources", () => {
  const markdown = skillMarkdown(skillSource);
  assert.ok(!markdown.includes("name: code-review"));
  assert.equal(
    skillMarkdown("---\nnot closed\n# Body"),
    "---\nnot closed\n# Body",
  );
  assert.equal(skillMarkdown("---\r\nname: test\r\n---\r\n# Body"), "# Body");
  const html = renderToStaticMarkup(
    createElement(Renderer, { text: markdown, document: true }),
  );
  assert.ok(html.includes("审查流程"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="/api/config"'));
  assert.ok(!html.includes('class="diagram"'));
  assert.ok(html.includes("flowchart LR"));
});
