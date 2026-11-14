import { randomUUID, createHash } from "node:crypto";
import { mkdir, rm, lstat, writeFile, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { Codex } from "./codex.js";
import type { Store } from "./db.js";
import type { ExtensionRuntime } from "./extension-runtime.js";
import { PublicError } from "./public-error.js";
import {
  importTree,
  writeImportTree,
  extractImportZip,
} from "./import-files.js";
import { githubCatalog, githubBytes } from "./github-imports.js";
import { IMPORT_LIMITS } from "../shared/imports.js";
import { marketplaceKey, marketplaceState } from "./marketplace-state.js";
import type {
  ManagedMarketplace,
  MarketplaceSource,
  MarketplaceView,
} from "../shared/marketplaces.js";
import type { PluginListResponse } from "../generated/codex/v2/PluginListResponse.js";

const sourceSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      if (isAbsolute(value)) return true;
      if (/^[\w.-]+\/[\w.-]+(?:@[\w./-]+)?$/.test(value)) return true;
      try {
        const u = new URL(value);
        return (
          ["https:", "http:", "ssh:"].includes(u.protocol) &&
          !u.password &&
          (!u.username || (u.protocol === "ssh:" && u.username === "git")) &&
          !u.search &&
          !u.hash
        );
      } catch {
        return /^git@[\w.-]+:[\w./-]+$/.test(value);
      }
    }, "请输入仓库地址、owner/repo 或服务器上的绝对目录"),
  refName: z.string().trim().min(1).max(200).optional(),
  sparsePaths: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(500)
        .refine((v) => !v.startsWith("/") && !v.split("/").includes("..")),
    )
    .max(16)
    .optional(),
});
export type PreparedMarketplace = {
  name: string;
  displayName: string;
  root: string;
  discard: () => Promise<void>;
};
/** Resolve a GitHub page URL before passing its immutable directory to native Codex. */
function marketplaceDirectoryPath(path: string) {
  return path.replace(/(?:^|\/)(?:\.agents\/plugins|\.claude-plugin)(?:\/marketplace\.json)?$/, "");
}
export async function githubMarketplaceDirectory(
  staging: string,
  url: string,
  fetcher: typeof fetch = fetch,
  resolved?: Awaited<ReturnType<ReturnType<typeof githubCatalog>["resolve"]>>,
) {
  const source = resolved || await githubCatalog(fetcher).resolve(url);
  // A link to the manifest identifies its owning marketplace root, not the metadata folder.
  const path = marketplaceDirectoryPath(source.path);
  if (path.endsWith(".json"))
    throw new PublicError("请粘贴商店目录或 marketplace.json 清单链接");
  const archive = join(staging, "github.zip"),
    extracted = join(staging, "github");
  await writeFile(
    archive,
    await githubBytes(
      `https://codeload.github.com/${source.owner}/${source.repo}/zip/${source.commit}`,
      IMPORT_LIMITS.archiveBytes,
      fetcher,
    ),
    { mode: 0o600 },
  );
  await extractImportZip(archive, extracted);
  const roots = await readdir(extracted);
  if (roots.length !== 1) throw new PublicError("GitHub 包结构异常");
  const selected = join(extracted, roots[0], path);
  const info = await lstat(selected).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink())
    throw new PublicError("链接中的商店目录不存在");
  return selected;
}

/** Native Codex owns parsing and repository acquisition. No plugin is installed or executed here. */
export async function prepareMarketplace(
  directory: string,
  source: MarketplaceSource,
): Promise<PreparedMarketplace> {
  const staging = join(directory, "extensions", "marketplaces", randomUUID()),
    work = join(staging, "work");
  await mkdir(work, { recursive: true, mode: 0o700 });
  const native = new Codex(work, () => ({
    CODEX_HOME: join(staging, "codex"),
  }));
  try {
    let input = source.source, refName = source.refName;
    if (
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/(tree|blob|releases)\//.test(input)
    ) {
      const location = await githubCatalog().resolve(input);
      if (!marketplaceDirectoryPath(location.path)) {
        // Repository-root links use native acquisition, including repositories larger than ZIP import budgets.
        input = `https://github.com/${location.owner}/${location.repo}.git`;
        refName = location.commit;
      } else input = await githubMarketplaceDirectory(staging, input, fetch, location);
    }
    if (isAbsolute(input)) {
      // Capture local sources too: editing a source directory cannot mutate a published catalog.
      const info = await lstat(input);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new PublicError("请选择包含商店清单的真实目录");
      const snapshot = join(staging, "source");
      await writeImportTree(snapshot, (await importTree(input)).files);
      input = snapshot;
    }
    await native.start();
    if (native.state !== "ready")
      throw new PublicError("Codex 商店读取器未就绪");
    const result = await native.call(
      "marketplace/add",
      {
        source: input,
        refName,
        sparsePaths: source.sparsePaths,
      },
      120_000,
    );
    const name = z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
      .parse(result.marketplaceName);
    const root = z.string().min(1).parse(result.installedRoot);
    const listed = await native.call("plugin/list", {
      cwds: [root],
      marketplaceKinds: ["local"],
    });
    const market = listed.marketplaces.find((m) => m.name === name);
    if (!market || listed.marketplaceLoadErrors?.length)
      throw new PublicError("商店目录无法解析，原商店未改变");
    return {
      name,
      displayName: market.interface?.displayName || name,
      root,
      discard: () => rm(staging, { recursive: true, force: true }),
    };
  } catch (error) {
    await native.stopAndWait();
    await rm(staging, { recursive: true, force: true });
    throw error instanceof PublicError &&
      !error.message.startsWith("Codex 操作未完成")
      ? error
      : new PublicError("商店读取失败，请检查来源地址和访问权限后重试");
  } finally {
    await native.stopAndWait();
  }
}
export function marketplaceLibrary(
  db: Store,
  extensions: ExtensionRuntime,
  discover: () => Promise<PluginListResponse>,
  prepare = prepareMarketplace,
) {
  async function list(): Promise<MarketplaceView> {
    const state = marketplaceState(db),
      native = await discover();
    const entries = native.marketplaces
      .map((m) => {
        const managed = state.entries.find((e) => e.name === m.name);
        return {
          ...(managed || {
            id: m.name,
            name: m.name,
            displayName: m.interface?.displayName || m.name,
            source: "",
            updated: 0,
          }),
          managed: !!managed,
          plugins: m.plugins.length,
          installed: m.plugins.filter((p) => p.installed).length,
        };
      })
      .map(({ root: _, ...entry }: any) => entry);
    for (const e of state.entries)
      if (!entries.some((v: any) => v.id === e.id)) {
        const { root: _, ...entry } = e;
        entries.push({ ...entry, managed: true, plugins: 0, installed: 0 });
      }
    return { revision: state.revision, entries };
  }
  async function mutate(action: string, input: unknown) {
    const p = z
      .object({
        operationId: z.string().uuid(),
        expectedRevision: z.string(),
        id: z.string().optional(),
        source: z.string().optional(),
        refName: z.string().optional(),
        sparsePaths: z.array(z.string()).optional(),
      })
      .parse(input);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ action, ...p }))
      .digest("hex");
    return extensions.resources.exclusive(
      ["marketplace-registry"],
      async () => {
        const state = marketplaceState(db),
          receipt = state.receipts[p.operationId];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new PublicError("操作编号已用于另一项修改");
          return { state: "saved", id: receipt.id };
        }
        if (state.revision !== p.expectedRevision)
          throw new PublicError("商店列表已变化，请刷新后重试");
        const current = state.entries.find((e) => e.id === p.id);
        if (action !== "marketplace/add" && !current)
          throw new PublicError("此商店由其他来源管理");
        let prepared: PreparedMarketplace | undefined,
          committed = false;
        const id = current?.id || randomUUID();
        try {
          let entries = state.entries;
          const native = await discover();
          if (action === "marketplace/remove") {
            if (
              native.marketplaces
                .find((m) => m.name === current!.name)
                ?.plugins.some((p) => p.installed) ||
              Object.entries(extensions.snapshot().values.plugins).some(
                ([id, value]) =>
                  id.endsWith(`@${current!.name}`) && value.installed !== false,
              )
            )
              throw new PublicError("请先卸载此商店中已安装的插件，再移除商店");
            entries = entries.filter((e) => e.id !== id);
          } else {
            if (action === "marketplace/add" && entries.length >= 32)
              throw new PublicError("最多可添加32个商店");
            const source = sourceSchema.parse(current || p);
            prepared = await prepare(db.directory, source);
            if (current && current.name !== prepared.name)
              throw new PublicError("更新后的商店身份不同，原商店未改变");
            if (
              native.marketplaces.some(
                (m) => m.name === prepared!.name && m.name !== current?.name,
              ) ||
              entries.some((e) => e.name === prepared!.name && e.id !== id)
            )
              throw new PublicError("已有同名商店，请更新已有商店");
            const entry: ManagedMarketplace = {
              ...source,
              id,
              name: prepared.name,
              displayName: prepared.displayName,
              root: prepared.root,
              updated: Date.now(),
            };
            entries = entries.filter((e) => e.id !== id).concat(entry);
          }
          // A second check protects against another process; registration and execution revision commit together.
          db.raw.exec("BEGIN IMMEDIATE");
          try {
            if (marketplaceState(db).revision !== state.revision)
              throw new PublicError("商店列表已变化，请刷新后重试");
            const receipts = Object.fromEntries(
              Object.entries(state.receipts).slice(-127),
            );
            receipts[p.operationId] = { fingerprint, id };
            db.set(
              marketplaceKey,
              JSON.stringify({ revision: randomUUID(), entries, receipts }),
            );
            extensions.invalidate();
            db.raw.exec("COMMIT");
            committed = true;
          } catch (error) {
            db.raw.exec("ROLLBACK");
            extensions.reload();
            throw error;
          }
          return { state: "saved", id };
        } finally {
          if (prepared && !committed) await prepared.discard();
        }
      },
    );
  }
  return { list, mutate };
}
