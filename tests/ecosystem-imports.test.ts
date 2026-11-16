import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ecosystemPackages } from "../server/ecosystem-imports.js";
import { fileDigest, type ImportFile } from "../server/import-files.js";
import { scanNativeImport, entryFiles } from "../server/import-native.js";
const file = (path: string, text: string): ImportFile => ({
  path,
  data: Buffer.from(text),
  sha256: fileDigest(text),
  mode: 0o600,
});
const skill =
  "---\nname: portable-sample\ndescription: A harmless portable test skill\n---\nRead references/check.md and answer.\n";
test("foreign declarations identify their actual skills and reject aliases/traversal/duplicate manifests", () => {
  const src = [
    file(
      "openclaw.plugin.json",
      JSON.stringify({ id: "sample", skills: ["./skills/"] }),
    ),
    file("skills/sample/SKILL.md", skill),
  ];
  assert.deepEqual(ecosystemPackages(src)[0].skillRoots, ["skills"]);
  assert.throws(() =>
    ecosystemPackages([
      file(
        "openclaw.plugin.json",
        JSON.stringify({ id: "sample", skills: ["../outside"] }),
      ),
    ]),
  );
  assert.throws(() =>
    ecosystemPackages([
      file("plugin.yaml", "name: &name example\nvalue: *name"),
    ]),
  );
  assert.throws(() =>
    ecosystemPackages([
      file("plugin.yaml", "name: x"),
      file("plugin.yml", "name: y"),
    ]),
  );
});
