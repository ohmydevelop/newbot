import test from "node:test";
import assert from "node:assert/strict";
import {
  validateReceipt,
  requiredChecks,
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
