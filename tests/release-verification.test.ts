import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  validateReceipt,
  requiredChecks,
  directoryHash,
} from "../scripts/release-verification";
const good = () => ({
  source: "abc",
  webHash: "123",
  created: new Date().toISOString(),
  checks: Object.fromEntries(
    requiredChecks.map((name) => [
      name,
      { passed: true, evidence: import.meta.filename },
    ]),
  ),
});
test("JS receipt and Python deployment hash identically order shared-prefix files and directories", () => {
  const root = mkdtempSync(join(tmpdir(), "release-hash-"));
  try {
    mkdirSync(join(root, "package"));
    writeFileSync(join(root, "package.js"), "entry");
    writeFileSync(join(root, "package", "index.js"), "nested");
    const actual = execFileSync(
      "python3",
      [
        "-c",
        "from pathlib import Path; import sys; from release_integrity import directory_hash; print(directory_hash(Path(sys.argv[1])))",
        root,
      ],
      { cwd: resolve("scripts"), encoding: "utf8" },
    ).trim();
    assert.equal(actual, directoryHash(root));
    writeFileSync(join(root, "package.js"), "tampered");
    assert.notEqual(actual, directoryHash(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("发布门槛拒绝缺失、失败、不同源码及不同资产", () => {
  validateReceipt(good(), "abc", "123");
  assert.throws(() => validateReceipt(good(), "other", "123"));
  assert.throws(() => validateReceipt(good(), "abc", "other"));
  for (const name of requiredChecks) {
    const missing = good();
    delete missing.checks[name];
    assert.throws(() => validateReceipt(missing, "abc", "123"));
    const failed = good();
    failed.checks[name].passed = false;
    assert.throws(() => validateReceipt(failed, "abc", "123"));
    const evidence = good();
    evidence.checks[name].evidence = "/does/not/exist";
    assert.throws(() => validateReceipt(evidence, "abc", "123"));
  }
});

test("前后端联合发布拒绝未验证或变更后的服务端构建", () => {
  assert.throws(() => validateReceipt(good(), "abc", "123", "server"));
  validateReceipt({ ...good(), serverHash: "server" }, "abc", "123", "server");
  assert.throws(() =>
    validateReceipt({ ...good(), serverHash: "before" }, "abc", "123", "after"),
  );
});
