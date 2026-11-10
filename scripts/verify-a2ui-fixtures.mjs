import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export function verifyA2uiFixtures() {
  const root = new URL("../examples/a2ui/official/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url)),
  );
  const core = lock.packages["node_modules/@a2ui/web_core"];
  assert.equal(
    core.version,
    manifest.version,
    "A2UI runtime version changed; re-audit the baseline",
  );
  assert.equal(
    core.integrity,
    manifest.integrity,
    "A2UI package integrity changed",
  );
  for (const [file, { source, sha256 }] of Object.entries(manifest.files)) {
    const fixture = readFileSync(new URL(file, root));
    assert.equal(
      createHash("sha256").update(fixture).digest("hex"),
      sha256,
      `${file} changed`,
    );
    assert.deepEqual(
      fixture,
      readFileSync(
        fileURLToPath(
          new URL(`../node_modules/@a2ui/web_core/${source}`, import.meta.url),
        ),
      ),
      `${file} differs from the pinned official package`,
    );
  }
  return manifest;
}
