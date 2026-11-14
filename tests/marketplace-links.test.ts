import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  githubMarketplaceDirectory,
  prepareMarketplace,
} from "../server/marketplaces.js";
import { zip } from "./import-zip-fixture.js";

test("store URLs infer slash branch and subdirectory, accept manifest links, reject missing directories, and native Codex parses captured store", async () => {
  const root = await mkdtemp(join(tmpdir(), "marketplace-link-")),
    sha = "a".repeat(40),
    requests: string[] = [];
  const archive = zip([
    {
      name: "repo-snapshot/stores/daily/.agents/plugins/marketplace.json",
      data: Buffer.from(
        JSON.stringify({
          name: "link-acceptance",
          plugins: [
            {
              name: "notes",
              source: { source: "local", path: "./plugins/notes" },
              policy: {
                installation: "AVAILABLE",
                authentication: "ON_INSTALL",
              },
            },
          ],
        }),
      ),
    },
    {
      name: "repo-snapshot/stores/daily/plugins/notes/plugin.json",
      data: Buffer.from(
        JSON.stringify({
          name: "notes",
          version: "1.0.0",
          description: "Synthetic URL acceptance",
        }),
      ),
    },
  ]);
  const fetcher = (async (input: string, options: RequestInit) => {
    requests.push(input);
    assert.equal(options.redirect, "error");
    if (input === `https://codeload.github.com/sample/repo/zip/${sha}`)
      return new Response(archive);
    return Response.json(
      { sha },
      { status: input.endsWith("/commits/feature%2Fcatalog") ? 200 : 404 },
    );
  }) as typeof fetch;
  try {
    for (const suffix of [
      "tree/feature/catalog/stores/daily",
      "tree/feature/catalog/stores/daily/.agents/plugins",
      "blob/feature/catalog/stores/daily/.agents/plugins/marketplace.json",
    ]) {
      const staging = join(root, String(requests.length));
      await mkdir(staging);
      const selected = await githubMarketplaceDirectory(
        staging,
        `https://github.com/sample/repo/${suffix}`,
        fetcher,
      );
      assert.equal(
        JSON.parse(
          await readFile(
            join(selected, ".agents/plugins/marketplace.json"),
            "utf8",
          ),
        ).name,
        "link-acceptance",
      );
      if (process.env.NEWBOT_NATIVE_MARKETPLACE_TEST === "1") {
        const native = await prepareMarketplace(root, { source: selected });
        assert.equal(native.name, "link-acceptance");
        await native.discard();
      }
    }
    const bad = join(root, "missing");
    await mkdir(bad);
    await assert.rejects(
      githubMarketplaceDirectory(
        bad,
        "https://github.com/sample/repo/tree/feature/catalog/missing",
        fetcher,
      ),
      /目录不存在/,
    );
    assert.ok(requests.some((u) => u.endsWith("/commits/feature%2Fcatalog")));
    assert.ok(
      requests
        .filter((u) => u.includes("codeload"))
        .every((u) => u.endsWith(sha)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("reserved native stores produce an actionable error without exposing upstream details", async()=>{
 const {nativeRequestError}=await import("../server/codex.js");
 assert.equal(nativeRequestError("marketplace/add",{message:"marketplace `openai-curated` is reserved and cannot be added from this source"}),"此商店由 Codex 内置管理，无需重复添加");
 assert.doesNotMatch(nativeRequestError("marketplace/add",{message:"private repository token=secret"}),/secret/);
});
