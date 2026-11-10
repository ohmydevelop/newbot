// The published official example is bundled. Extract only its pinned, checksum-verified test files.
import { createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
export const officialApp = {
  package: "@modelcontextprotocol/server-basic-vanillajs",
  version: "2.0.4",
  integrity:
    "sha512-L+IOxLjfX9oAwvnzLAMGX1pwBsIsXUsc9mB5iOTFuQ7lIaejetsrfYngPKwf9ZPHk9iCNVbHHaI7sj5dqax55Q==",
  source:
    "https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-vanillajs",
};
export const officialDirectory = resolve(".data/official-mcp-app");
const files = [
  "dist/index.js",
  "dist/server.js",
  "dist/mcp-app.html",
  "package.json",
];
export async function prepareOfficialApp() {
  try {
    const metadata = JSON.parse(
      await readFile(join(officialDirectory, "verified.json"), "utf8"),
    );
    if (
      metadata.integrity === officialApp.integrity &&
      metadata.version === officialApp.version
    ) {
      for (const file of files) {
        const digest = createHash("sha256")
          .update(await readFile(join(officialDirectory, file)))
          .digest("hex");
        if (digest !== metadata.files[file])
          throw new Error("Cached official fixture was modified");
      }
      return officialDirectory;
    }
  } catch {
    /* Download a clean pinned fixture if absent or changed. */
  }
  await mkdir(resolve(".data"), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(resolve(".data/official-download-"));
  try {
    const url = `https://registry.npmjs.org/@modelcontextprotocol/server-basic-vanillajs/-/server-basic-vanillajs-${officialApp.version}.tgz`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Official example download failed");
    const archive = Buffer.from(await response.arrayBuffer());
    if (
      "sha512-" + createHash("sha512").update(archive).digest("base64") !==
      officialApp.integrity
    )
      throw new Error("Official example integrity mismatch");
    const path = join(staging, "package.tgz");
    await writeFile(path, archive, { mode: 0o600 });
    const extract = spawnSync(
      "tar",
      [
        "-xzf",
        path,
        "-C",
        staging,
        "--strip-components=1",
        ...files.map((f) => "package/" + f),
      ],
      { encoding: "utf8" },
    );
    if (extract.status !== 0)
      throw new Error("Could not extract official example");
    const checksums = {};
    for (const file of files)
      checksums[file] = createHash("sha256")
        .update(await readFile(join(staging, file)))
        .digest("hex");
    await rm(path);
    await writeFile(
      join(staging, "verified.json"),
      JSON.stringify({ ...officialApp, files: checksums }, null, 2),
      { mode: 0o600 },
    );
    await rm(officialDirectory, { recursive: true, force: true });
    await rename(staging, officialDirectory);
    return officialDirectory;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === new URL(import.meta.url).pathname
) {
  await prepareOfficialApp();
  console.log(
    `Verified official MCP App ${officialApp.version} (stdio test only).`,
  );
}
