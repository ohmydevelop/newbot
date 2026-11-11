import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const repo = resolve(import.meta.dirname, ".."),
  native = join(repo, "native/codex");
const manifest = JSON.parse(
  await readFile(join(native, "manifest.json"), "utf8"),
);
const root = resolve(
  process.env.NEWBOT_NATIVE_BUILD_DIR || join(repo, ".data/native/managed"),
);
if (root === repo || !root.includes("/"))
  throw Error("Use a dedicated native build directory");
const source = join(root, "source"),
  stamp = join(root, "source.json");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--prepare-only"))
  throw Error("Supported option: --prepare-only");
const hash = createHash("sha256").update(JSON.stringify(manifest));
for (const patch of manifest.patches)
  hash.update(await readFile(join(native, patch)));
const sourceDigest = hash.digest("hex");
const run = (cmd, args, cwd = source, env = {}) =>
  new Promise((done, fail) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(Error(`${cmd} exited with ${code}`)),
    );
  });
const gitOutput = (args) =>
  new Promise((done, fail) => {
    const chunks = [];
    const child = spawn("git", args, {
      cwd: source,
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.on("data", (data) => chunks.push(data));
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? done(Buffer.concat(chunks))
        : fail(Error(`git exited with ${code}`)),
    );
  });
async function treeDigest() {
  const hash = createHash("sha256")
    .update(await gitOutput(["rev-parse", "HEAD"]))
    .update(await gitOutput(["diff", "--binary", "HEAD"]));
  const files = (
    await gitOutput(["ls-files", "--others", "--exclude-standard", "-z"])
  )
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const file of files)
    hash.update(file + "\0").update(await readFile(join(source, file)));
  return hash.digest("hex");
}
await mkdir(root, { recursive: true });
let prior;
try {
  prior = JSON.parse(await readFile(stamp, "utf8"));
} catch {}
if (prior?.sourceDigest !== sourceDigest) {
  let exists = false;
  try {
    await access(source);
    exists = true;
  } catch {}
  if (exists)
    throw Error(
      "Existing native source does not match this manifest. Select a fresh NEWBOT_NATIVE_BUILD_DIR; it will not be reset.",
    );
  await run("git", ["init", source], root);
  await run("git", ["remote", "add", "origin", manifest.upstream]);
  await run("git", ["fetch", "--depth", "1", "origin", manifest.commit]);
  await run("git", ["checkout", "--detach", "FETCH_HEAD"]);
  for (const patch of manifest.patches) {
    const path = join(native, patch);
    await run("git", ["apply", "--check", path]);
    await run("git", ["apply", path]);
  }
  prior = {
    sourceDigest,
    upstream: manifest.commit,
    treeDigest: await treeDigest(),
  };
  await writeFile(stamp, JSON.stringify(prior, null, 2) + "\n");
}
// The source is deliberately retained for review. Later manual edits require a new
// manifest/build directory rather than being overwritten by a reset.
if ((await treeDigest()) !== prior.treeDigest)
  throw Error(
    "Native source changed since preparation. Use a fresh build directory or record the changes in a new manifest; existing files will not be reset.",
  );
if (args.includes("--prepare-only")) {
  console.log(`Verified native source ${manifest.commit}: ${source}`);
  process.exit(0);
}
await run(
  "cargo",
  [
    `+${manifest.rust}`,
    "build",
    "--locked",
    "-p",
    "codex-cli",
    "--profile",
    manifest.profile,
  ],
  join(source, "codex-rs"),
  {
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "1",
    CARGO_PROFILE_DEV_DEBUG: "0",
    CARGO_TARGET_DIR: join(root, "target"),
  },
);
await mkdir(join(root, "bin"), { recursive: true });
const binary = join(root, "bin", "codex");
await copyFile(join(root, "target", manifest.profile, "codex"), binary);
const sha256 = createHash("sha256")
  .update(await readFile(binary))
  .digest("hex");
await writeFile(
  join(root, "build.json"),
  JSON.stringify(
    {
      sourceDigest,
      upstream: manifest.commit,
      rust: manifest.rust,
      binary,
      sha256,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Built ${binary}\nSHA-256 ${sha256}`);
