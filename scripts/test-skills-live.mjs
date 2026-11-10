// Read-only native integration proof: isolated Codex Home/workspace, no model request.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Codex } from "../server/codex.ts";
import { skillLibrary } from "../server/skills.ts";
import { CODEX_VERSION } from "../generated/version.ts";
const directory = mkdtempSync(join(tmpdir(), "newbot-skills-native-"));
const cwd = join(directory, "workspace"),
  nativeHome = join(directory, "codex-home");
const path = join(cwd, ".agents", "skills", "native-proof", "SKILL.md");
const content =
  "---\nname: native-proof\ndescription: Read-only local discovery proof for newbot\n---\n# Native skill proof\n\nThis text is a test fixture, never a model task.\n";
mkdirSync(join(cwd, ".agents", "skills", "native-proof"), { recursive: true });
mkdirSync(nativeHome);
writeFileSync(path, content);
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
const codex = new Codex(cwd, () => ({ CODEX_HOME: nativeHome }));
try {
  await codex.start();
  assert.equal(codex.state, "ready", codex.reason);
  const library = skillLibrary(codex, cwd);
  const { skills } = await library.list();
  const found = skills.find((skill) => skill.name === "native-proof");
  assert.ok(found, "Native skills/list did not discover the project fixture");
  const document = await library.read(found.id);
  assert.equal(document.content, content);
  assert.equal(
    document.sha256,
    createHash("sha256").update(content).digest("hex"),
  );
  const output = resolve(".data/skills-live");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        codex: CODEX_VERSION,
        source: "native skills/list",
        scope: found.scope,
        bytes: document.size,
        sha256: document.sha256,
        noModelRequest: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `Native Skills discovery and controlled read passed (${CODEX_VERSION}); no model request.`,
  );
} finally {
  await codex.stopAndWait();
  rmSync(directory, { recursive: true, force: true });
}
