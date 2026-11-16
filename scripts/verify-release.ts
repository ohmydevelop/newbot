import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { validateReceipt, webHash } from "./release-verification";
const directory = resolve(process.argv[2] || "dist/web");
const receiptFile = process.argv[3];
if (!receiptFile) throw new Error("必须提供与当前构建对应的验收凭据文件");
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = execFileSync(
  "git",
  [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "web",
    "shared",
    "server",
    "scripts",
    "package.json",
    "package-lock.json",
  ],
  { encoding: "utf8" },
).trim();
if (dirty) throw new Error("产品源码尚未提交，禁止发布");
const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
const hash = webHash(directory);
validateReceipt(receipt, source, hash);
writeFileSync(
  resolve(directory, "release-manifest.json"),
  JSON.stringify(
    {
      source,
      webHash: hash,
      verifiedAt: receipt.created,
      checks: Object.keys(receipt.checks),
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ source, webHash: hash, verified: true }));
