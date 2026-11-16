import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
export const requiredChecks = [
  "types",
  "unit",
  "design",
  "browser",
  "motion",
] as const;
export type VerificationReceipt = {
  source: string;
  webHash: string;
  serverHash?: string;
  checks: Record<string, { passed: boolean; evidence: string }>;
  created: string;
};
export function webHash(directory: string) {
  const manifest = JSON.parse(
    readFileSync(join(directory, ".vite/manifest.json"), "utf8"),
  );
  const paths = [
    "index.html",
    ...new Set<string>(
      Object.values(manifest).flatMap((r: any) => [
        r.file,
        ...(r.css || []),
        ...(r.assets || []),
      ]),
    ),
  ].sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update(readFileSync(join(directory, path)));
  }
  return hash.digest("hex");
}
export function directoryHash(directory: string) {
  const files: string[] = [];
  function walk(path = "") {
    for (const entry of readdirSync(join(directory, path), {
      withFileTypes: true,
    })) {
      const relative = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`Unsupported release entry: ${relative}`);
    }
  }
  walk();
  assert.ok(files.length, "服务端构建为空");
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(file);
    hash.update(readFileSync(join(directory, file)));
  }
  return hash.digest("hex");
}
export function validateReceipt(
  receipt: VerificationReceipt,
  source: string,
  hash: string,
  serverHash?: string,
) {
  assert.equal(receipt.source, source, "验证凭据不对应当前源码");
  assert.equal(receipt.webHash, hash, "验证后构建资产发生变化");
  if (serverHash)
    assert.equal(
      receipt.serverHash,
      serverHash,
      "服务端构建未验证或验证后发生变化",
    );
  assert.ok(Number.isFinite(Date.parse(receipt.created)), "缺少验证时间");
  for (const name of requiredChecks) {
    assert.equal(receipt.checks[name]?.passed, true, `${name}未通过，禁止发布`);
    assert.ok(
      receipt.checks[name].evidence &&
        existsSync(receipt.checks[name].evidence),
      `${name}缺少验收证据`,
    );
  }
}
