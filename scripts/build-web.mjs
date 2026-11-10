// Publish a complete build and retain one preceding asset generation for open browser tabs.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { safeAssetPaths, retainedAssets } from "../shared/web-assets.ts";
const root = resolve("dist/web");
mkdirSync(resolve(".data"), { recursive: true, mode: 0o700 });
const staging = mkdtempSync(resolve(".data/web-build-"));
const backup = resolve(".data/web-previous-" + process.pid);
function run(args) {
  const p = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (p.status !== 0) throw new Error("Web build failed");
}
function manifestAssets(folder) {
  const manifest = join(folder, ".vite/manifest.json");
  if (existsSync(manifest)) {
    const rows = Object.values(JSON.parse(readFileSync(manifest, "utf8")));
    return safeAssetPaths([
      ...new Set(
        rows.flatMap((r) => [r.file, ...(r.css || []), ...(r.assets || [])]),
      ),
    ]);
  }
  const assets = join(folder, "assets");
  return existsSync(assets)
    ? readdirSync(assets)
        .filter((f) => !f.endsWith(".br") && !f.endsWith(".gz"))
        .map((f) => "assets/" + f)
    : [];
}
try {
  const current = manifestAssets(root);
  let earlier = [];
  try {
    earlier = safeAssetPaths(
      JSON.parse(
        readFileSync(join(root, ".vite/retained-assets.json"), "utf8"),
      ),
    );
  } catch {}

  const priorEntry = existsSync(join(root, "index.html"))
    ? /src="([^"]+\.js)"/.exec(
        readFileSync(join(root, "index.html"), "utf8"),
      )?.[1]
    : undefined;
  run([
    "node_modules/vite/bin/vite.js",
    "build",
    "--outDir",
    staging,
    "--emptyOutDir",
  ]);
  const next = manifestAssets(staging);
  const previous = retainedAssets(current, earlier, next);
  const nextSet = new Set(next);
  mkdirSync(join(staging, ".vite"), { recursive: true });
  writeFileSync(
    join(staging, ".vite/retained-assets.json"),
    JSON.stringify(previous.filter((asset) => !nextSet.has(asset))),
  );
  // Preserve upstream notices alongside the separately bundled PDF runtime assets.
  const notices = join(staging, "licenses/pdfjs");
  mkdirSync(notices, { recursive: true });
  copyFileSync("node_modules/pdfjs-dist/LICENSE", join(notices, "LICENSE.txt"));
  for (const folder of ["standard_fonts", "wasm"])
    for (const name of readdirSync(join("node_modules/pdfjs-dist", folder)))
      if (name.startsWith("LICENSE"))
        copyFileSync(
          join("node_modules/pdfjs-dist", folder, name),
          join(notices, `${name}.txt`),
        );
  for (const file of previous)
    for (const suffix of ["", ".br", ".gz"]) {
      const from = join(root, file + suffix),
        to = join(staging, file + suffix);
      if (existsSync(from) && !existsSync(to)) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
    }
  run(["scripts/build-assets.mjs", staging]);
  // The private staging directory becomes public static output at publication.
  // Runtime containers may read it as a different unprivileged user.
  chmodSync(staging, 0o755);
  mkdirSync(dirname(root), { recursive: true });
  if (existsSync(root)) renameSync(root, backup);
  try {
    renameSync(staging, root);
  } catch (error) {
    if (existsSync(backup)) renameSync(backup, root);
    throw error;
  }
  rmSync(backup, { recursive: true, force: true });
  if (priorEntry && !existsSync(join(root, priorEntry)))
    throw new Error("Previous entry asset was not retained");
  console.log(
    `Published web build with one previous asset generation (${previous.length} asset paths).`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
