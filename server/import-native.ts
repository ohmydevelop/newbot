import { ecosystemPackages } from "./ecosystem-imports.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Codex } from "./codex.js";
import {
  fileDigest,
  importPath,
  importTree,
  inside,
  writeImportTree,
  type ImportFile,
} from "./import-files.js";
import { PublicError } from "./public-error.js";
import { pluginPackageDeclarations } from "./plugin-descriptor.js";
import { IMPORT_LIMITS, type ImportEntry } from "../shared/imports.js";
export type ScannedEntry = ImportEntry & {
  excludedRoots: string[];
  manifest: Record<string, string>;
  marketEntry?: Record<string, unknown>;
};
export function entryFiles(entry: ScannedEntry, files: ImportFile[]) {
  const prefix = entry.root === "." ? "" : entry.root + "/";
  return files
    .filter(
      (f) =>
        f.path.startsWith(prefix) &&
        !entry.excludedRoots.some(
          (r) => f.path === r || f.path.startsWith(r + "/"),
        ),
    )
    .map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
}
function checkManifestPaths(manifest: any, root: string) {
  for (const key of ["skills", "mcpServers", "hooks"]) {
    const v = manifest[key] ?? manifest.extensions?.["com.openai"]?.[key];
    for (const value of Array.isArray(v) ? v : [v])
      if (typeof value === "string") {
        const target = resolve(root, value);
        if (!inside(root, target) || !value.startsWith("./"))
          throw new PublicError(`插件 ${key} 路径必须在包内并使用 ./ 相对路径`);
      }
  }
}
export async function scanNativeImport(
  root: string,
  probeRoot: string,
  name: string,
): Promise<ScannedEntry[]> {
  const tree = await importTree(root),
    pluginRoots = new Map<string, any>();
  let ecosystems = ecosystemPackages(tree.files);
  for (const file of tree.files)
    if (file.path.endsWith("plugin.json")) {
      let json: any;
      try {
        json = JSON.parse(file.data.toString("utf8"));
      } catch {
        throw new PublicError(`插件清单不是有效 JSON：${file.path}`);
      }
      const compatibility = file.path.endsWith(".codex-plugin/plugin.json");
      if (
        !compatibility &&
        !String(json.$schema || "").startsWith(
          "https://agent-plugins.org/schemas/",
        )
      )
        continue;
      const folder = compatibility
        ? dirname(dirname(file.path))
        : dirname(file.path);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(json.name || ""))
        throw new PublicError("插件缺少有效名称");
      checkManifestPaths(json, join(root, folder));
      // The portable manifest wins only when both describe the same package.
      if (pluginRoots.has(folder) && pluginRoots.get(folder).name !== json.name)
        throw new PublicError("同一个插件目录声明了不同名称");
      pluginRoots.set(folder, json);
    }
  const marketEntries = new Map<string, any>();
  // Imported markets may only point at local packages that are present in this upload.
  for (const file of tree.files)
    if (file.path.endsWith("marketplace.json")) {
      let json: any;
      try {
        json = JSON.parse(file.data.toString("utf8"));
      } catch {
        throw new PublicError("市场清单不是有效 JSON");
      }
      if (!Array.isArray(json.plugins)) continue;
      for (const p of json.plugins) {
        const source = p.source;
        if (
          !source ||
          source.source !== "local" ||
          typeof source.path !== "string"
        )
          throw new PublicError(
            "市场中的远程依赖不会自动执行或下载，请提供包含插件目录的本地包",
          );
        const base = dirname(dirname(dirname(join(root, file.path))));
        const resolved = resolve(base, source.path),
          folder = relative(root, resolved) || ".";
        if (!inside(root, resolved))
          throw new PublicError("市场引用了上传包之外的目录");
        if (!pluginRoots.has(folder) || pluginRoots.get(folder).name !== p.name)
          throw new PublicError("市场条目与包内插件清单不一致");
        marketEntries.set(folder, p);
      }
    }
  const allPluginRoots = [...pluginRoots.keys()];
  ecosystems = ecosystems.filter(
    (pack) =>
      !allPluginRoots.some((root) => inside(join(root), join(pack.root))),
  );
  if (
    new Set(ecosystems.map((p) => p.ecosystem + ":" + p.name)).size !==
    ecosystems.length
  )
    throw new PublicError("包内存在同名生态插件，请分开导入");
  if (marketEntries.size)
    for (const folder of pluginRoots.keys())
      if (!marketEntries.has(folder)) pluginRoots.delete(folder);
  const work = join(probeRoot, "work"),
    market = join(probeRoot, "catalog"),
    marketFile = join(market, ".agents/plugins/marketplace.json");
  await mkdir(work, { recursive: true, mode: 0o700 });
  await mkdir(dirname(marketFile), { recursive: true, mode: 0o700 });
  const names = [...pluginRoots.values()].map((p) => p.name);
  if (new Set(names).size !== names.length)
    throw new PublicError("包内存在同名插件，请分开导入");
  for (const [folder, m] of pluginRoots) {
    const prefix = folder === "." ? "" : folder + "/";
    await writeImportTree(
      join(market, "plugins", m.name),
      tree.files
        .filter((f) => f.path.startsWith(prefix))
        .map((f) => ({ ...f, path: f.path.slice(prefix.length) })),
    );
  }
  await writeFile(
    marketFile,
    JSON.stringify({
      name: "newbot-import-scan",
      plugins: [...pluginRoots].map(([folder, m]) => ({
        ...marketEntries.get(folder),
        name: m.name,
        source: { source: "local", path: "./plugins/" + m.name },
      })),
    }),
    { mode: 0o600 },
  );
  const codex = new Codex(work, () => ({
    CODEX_HOME: join(probeRoot, "codex"),
  }));
  const entries: ScannedEntry[] = [];
  try {
    await codex.start();
    if (codex.state !== "ready")
      throw new PublicError("隔离的原生扫描器未就绪，请检查固定 Codex 版本");
    if (pluginRoots.size) {
      const listed = await codex.call("plugin/list", {
        cwds: [market],
        marketplaceKinds: ["local"],
      });
      if (listed.marketplaceLoadErrors?.length)
        throw new PublicError("原生运行时无法解析插件市场");
      for (const [folder, manifest] of pluginRoots) {
        const detail = (
          await codex.call("plugin/read", {
            marketplacePath: marketFile,
            pluginName: manifest.name,
          })
        ).plugin;
        const skills = detail.skills.map((s) => {
          if (
            !s.path ||
            !inside(join(market, "plugins", manifest.name), s.path)
          )
            throw new PublicError("插件技能没有可验证的包内路径");
          const path = join(
            folder,
            relative(join(market, "plugins", manifest.name), s.path),
          );
          return {
            id: fileDigest(path),
            path,
            name: s.name,
            description: s.description,
          };
        });
        entries.push({
          id: fileDigest("plugin:" + manifest.name),
          kind: "plugin",
          name: manifest.name,
          ...(typeof manifest.version === "string"
            ? { version: manifest.version }
            : {}),
          description:
            detail.description ||
            detail.summary.interface?.shortDescription ||
            "",
          root: folder,
          digest: "",
          skills,
          mcp: detail.mcpServers,
          hooks: detail.hooks.map((h) => h.eventName),
          excludedRoots: [],
          manifest: {},
          marketEntry: marketEntries.get(folder),
          ...(detail.summary.availability !== "AVAILABLE" ||
          detail.summary.installPolicy === "NOT_AVAILABLE"
            ? { blocked: "原生策略不允许安装此插件" }
            : {}),
          state: "available",
        });
      }
    }
    await codex.call("skills/extraRoots/set", { extraRoots: [root] });
    const listed = await codex.call("skills/list", {
      cwds: [work],
      forceReload: true,
    });
    const errors = listed.data
      .flatMap((d) => d.errors)
      .filter((e) => inside(root, e.path));
    if (errors.length)
      throw new PublicError(
        `原生扫描发现 ${errors.length} 个无效技能，请修正 SKILL.md 后重试`,
      );
    const allSkills = listed.data
      .flatMap((d) => d.skills)
      .filter(
        (s) =>
          inside(root, s.path) &&
          !allPluginRoots.some((p) => inside(join(root, p), s.path)),
      )
      .map((s) => ({
        id: fileDigest(relative(root, s.path)),
        path: relative(root, s.path),
        name: s.name,
        description: s.description,
      }));
    const belongs = (path: string, folder: string) =>
      folder === "." || path.startsWith(folder + "/");
    for (const pack of ecosystems) {
      const nested = ecosystems
        .filter((p) => p !== pack && belongs(p.root, pack.root))
        .map((p) => p.root);
      const foreignSkills = allSkills.filter(
        (s) =>
          belongs(s.path, pack.root) &&
          !nested.some((p) => belongs(s.path, p)) &&
          pack.skillRoots.some((root) => belongs(s.path, root)),
      );
      entries.push({
        id: fileDigest("ecosystem:" + pack.ecosystem + ":" + pack.name),
        kind: "skills",
        name: pack.name,
        description: "",
        root: pack.root,
        digest: "",
        skills: foreignSkills,
        mcp: [],
        hooks: [],
        excludedRoots: [...allPluginRoots, ...nested],
        manifest: {},
        state: "available",
        compatibility: { ecosystem: pack.ecosystem, notice: pack.notice },
        ...(!foreignSkills.length
          ? {
              blocked:
                "此插件没有可移植的 SKILL.md；原生运行代码需要适配为 MCP 后接入。",
            }
          : {}),
      });
    }
    const skills = allSkills.filter(
      (s) => !ecosystems.some((pack) => belongs(s.path, pack.root)),
    );
    if (skills.length)
      entries.unshift({
        id: fileDigest("skills:" + name),
        kind: "skills",
        name,
        description:
          skills.length === 1
            ? skills[0].description
            : `${skills.length} 个独立技能`,
        root: ".",
        digest: "",
        skills,
        mcp: [],
        hooks: [],
        excludedRoots: [...allPluginRoots, ...ecosystems.map((p) => p.root)],
        manifest: {},
        state: "available",
      });
    if (!entries.length)
      throw new PublicError("没有发现有效的 SKILL.md 或原生插件");
    if (entries.flatMap((e) => e.skills).length > IMPORT_LIMITS.skills)
      throw new PublicError("发现的技能超过 1024 项预算");
    for (const entry of entries) {
      const files = entryFiles(entry, tree.files);
      if (
        files.reduce((n, f) => n + f.data.length, 0) >
        IMPORT_LIMITS.packageBytes
      )
        throw new PublicError(`资源包 ${entry.name} 超过 32 MiB`);
      entry.manifest = Object.fromEntries(files.map((f) => [f.path, f.sha256]));
      if (entry.kind === "plugin") {
        entry.mcp = [
          ...new Set([
            ...entry.mcp,
            ...Object.keys(pluginPackageDeclarations(files).defs),
          ]),
        ];
      }
      entry.digest = fileDigest(
        files.map((f) => `${f.path}\0${f.mode}\0${f.sha256}`).join("\n"),
      );
    }
    return entries;
  } finally {
    await codex.stopAndWait();
    await rm(probeRoot, { recursive: true, force: true });
  }
}
