import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ecosystemPackages } from "../server/ecosystem-imports.js";
import { fileDigest, type ImportFile } from "../server/import-files.js";
import { scanNativeImport, entryFiles } from "../server/import-native.js";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { Codex } from "../server/codex.js";
const file = (path: string, text: string): ImportFile => ({
  path,
  data: Buffer.from(text),
  sha256: fileDigest(text),
  mode: 0o600,
});
const skill =
  "---\nname: portable-sample\ndescription: A harmless portable test skill\n---\nRead references/check.md and answer.\n";
test("native scanner groups OpenClaw and Hermes skills with resources, exposes unsupported runtime, does not run code", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-ecosystem-"));
  let ctx: Awaited<ReturnType<typeof createServer>> | undefined;
  async function start() {
    const cwd = join(root, "work");
    await mkdir(cwd, { recursive: true });
    const native = new Codex(cwd, () => ({ CODEX_HOME: join(root, "codex") }));
    const app = await createServer({
      directory: join(root, "data"),
      cwd,
      codex: native,
      password: "ecosystem-local-test",
      automationTimer: false,
    });
    await native.start();
    assert.equal(native.state, "ready", native.reason);
    await app.service.settings();
    return app;
  }
  const source = [
    file(
      "claw/openclaw.plugin.json",
      JSON.stringify({ id: "claw-sample", skills: ["./skills"] }),
    ),
    file("claw/skills/sample/SKILL.md", skill),
    file("claw/skills/sample/references/check.md", "Check sample data."),
    file("claw/index.ts", 'throw new Error("MUST_NOT_RUN")'),
    file(
      "hermes/plugin.yaml",
      "name: hermes-sample\nversion: 1.0.0\nentrypoint: plugin.py\n",
    ),
    file(
      "hermes/skills/example/SKILL.md",
      skill.replaceAll("portable-sample", "hermes-sample"),
    ),
    file("hermes/plugin.py", 'raise Exception("MUST_NOT_RUN")'),
    file("only-code/plugin.yaml", "name: only-code\nentrypoint: plugin.py\n"),
    file("only-code/plugin.py", 'raise Exception("MUST_NOT_RUN")'),
  ];
  try {
    const input = join(root, "input");
    for (const f of source) {
      await mkdir(join(input, f.path, ".."), { recursive: true });
      await writeFile(join(input, f.path), f.data);
    }
    const entries = await scanNativeImport(
      input,
      join(root, "probe"),
      "ecosystem-fixture",
    );
    assert.equal(entries.length, 3);
    const claw = entries.find((e) => e.name === "claw-sample")!;
    assert.equal(claw.kind, "skills");
    assert.equal(claw.compatibility?.ecosystem, "openclaw");
    assert.equal(claw.skills.length, 1);
    assert.equal(claw.hooks.length, 0);
    assert.equal(claw.mcp.length, 0);
    const resource = entryFiles(claw, source).find(
      (f) => f.path === "skills/sample/references/check.md",
    );
    assert(resource);
    assert(!entryFiles(claw, source).some((f) => f.path.includes("hermes/")));
    assert.equal(
      entries.find((e) => e.name === "hermes-sample")?.skills.length,
      1,
    );
    assert.match(
      entries.find((e) => e.name === "only-code")?.blocked || "",
      /没有可移植/,
    );
    ctx = await start();
    const session = await ctx.imports.create({
      kind: "files",
      name: "ecosystem lifecycle",
    });
    for (const f of source)
      await ctx.imports.upload(session.id, f.path, f.data);
    const scanned = await ctx.imports.scan(session.id);
    const installed = await ctx.imports.install(session.id, {
      operationId: randomUUID(),
      digest: scanned.digest,
      choices: scanned.entries
        .filter((e) => !e.blocked)
        .map((e) => ({ id: e.id, skills: e.skills.map((s) => s.id) })),
    });
    assert(
      installed.entries
        .filter((e) => !e.blocked)
        .every((e) => e.state === "installed"),
      JSON.stringify(installed.entries),
    );
    const visible = (await ctx.service.skills.list()).skills;
    assert(visible.some((s) => s.name === "portable-sample" && s.enabled));
    assert(visible.some((s) => s.name === "hermes-sample" && s.enabled));
    await ctx.app.close();
    ctx = await start();
    const restored = (await ctx.service.skills.list()).skills;
    const selected = restored.find((s) => s.name === "portable-sample")!;
    assert(selected.enabled);
    const document = await ctx.service.skills.read(selected.id);
    await ctx.service.skills.uninstall(selected.id, document.sha256);
    const after = (await ctx.service.skills.list()).skills;
    assert(!after.some((s) => s.name === "portable-sample"));
    assert(after.some((s) => s.name === "hermes-sample" && s.enabled));
  } finally {
    await ctx?.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
