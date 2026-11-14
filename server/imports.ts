import { confirmedPluginHooks } from "./plugin-hook-trust.js";
import { ExtensionResources, type PreparedResource } from "./extension-resources.js";
import { nativePluginAssets } from "./plugin-assets.js";
import { githubBytes, githubCatalog, pinnedGithubSource } from "./github-imports.js";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
  readdir,
} from "node:fs/promises";
import { basename, dirname, join, resolve, relative } from "node:path";
import { z } from "zod";
import type { Store } from "./db.js";
import type { Codex } from "./codex.js";
import type { bridge } from "./bridge.js";
import {
  IMPORT_LIMITS as limits,
  type ImportChoice,
  type ImportSession,
} from "../shared/imports.js";
import {
  importTree,
  importPath,
  fileDigest,
  ensureImportDirectory,
  extractImportZip,
  writeImportTree,
  inside,
} from "./import-files.js";
import {
  entryFiles,
  scanNativeImport,
  type ScannedEntry,
} from "./import-native.js";
import { PublicError } from "./public-error.js";
import { prepareRuntimeIsolation } from "./runtime-isolation.js";

type Session = Omit<ImportSession, "entries"> & { entries: ScannedEntry[] };
type Package = {
  id: string;
  kind: string;
  name: string;
  path: string;
  digest: string;
  content: string;
};
const sourceInput = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.enum(["files", "zip"]),
      name: z.string().min(1).max(120),
    }),
    z.object({
      kind: z.literal("github"),
      url: z.string().max(2048),
      ref: z.never().optional(),
      path: z.never().optional(),
    }),
  ])
  .and(z.object({ updatePluginId: z.string().min(1).max(300).optional() }));
const selection = z.object({
  operationId: z.string().uuid(),
  digest: z.string().regex(/^[a-f\d]{64}$/),
  choices: z
    .array(
      z.object({
        id: z.string().regex(/^[a-f\d]{64}$/),
        skills: z.array(z.string().regex(/^[a-f\d]{64}$/)).max(limits.skills),
        replace: z.boolean().default(false),
        confirmPackage: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(limits.skills),
});
export function extensionImports(
  directory: string,
  db: Store,
  codex: Codex,
  service: ReturnType<typeof bridge>,
) {
  const root = resolve(directory, "imports"),
    staging = join(root, "staging"),
    market = join(root, "marketplace"),
    marketFile = join(market, ".agents/plugins/marketplace.json");
  const active = new Set<string>();
  const github = githubCatalog();
  let scanning = false;
  const folder = (id: string) => join(staging, z.string().uuid().parse(id));
  function save(s: Session) {
    db.raw
      .prepare(
        "INSERT INTO extension_imports VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,content=excluded.content,updated=excluded.updated",
      )
      .run(s.id, s.state, JSON.stringify(s), Date.now());
  }
  function get(id: string): Session {
    z.string().uuid().parse(id);
    const row = db.raw
      .prepare("SELECT content FROM extension_imports WHERE id=?")
      .get(id) as { content: string } | undefined;
    if (!row) throw new PublicError("导入记录不存在");
    return JSON.parse(row.content);
  }
  const packages = () =>
    db.raw.prepare("SELECT * FROM extension_packages").all() as Package[];
  async function pluginPreferences(p: Package) {
    const detail = await service.plugins.read(`${p.name}@newbot-imports`);
    const value = {
      enabled: detail.enabled,
      skills: detail.skills
        .map((s) => ({ name: s.name, enabled: s.enabled }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    return { ...value, fingerprint: fileDigest(JSON.stringify(value)) };
  }
  let marketWrites = Promise.resolve();
  function writeMarket() {
    // Read the authoritative index inside the queue, so an earlier writer cannot
    // overwrite a marketplace published after another package was installed.
    const write = marketWrites.then(writeMarketNow);
    marketWrites = write.catch(() => {});
    return write;
  }
  async function writeMarketNow() {
    await ensureImportDirectory(root, dirname(marketFile));
    const plugins = packages()
      .filter((p) => p.kind === "plugin" && (!JSON.parse(p.content).pluginId || JSON.parse(p.content).pluginId.endsWith("@newbot-imports")))
      .map((p) => ({
        ...JSON.parse(p.content).marketEntry,
        name: p.name,
        source: { source: "local", path: "./" + relative(market, p.path) },
      }));
    const temp = marketFile + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify({ name: "newbot-imports", plugins }), {
      mode: 0o600,
    });
    await rename(temp, marketFile);
    db.set("imports:marketplace", market);
  }
  const nativeMutation = <T>(fn: () => Promise<T>) =>
    nativePluginAssets(codex, db, fn);
  async function pruneStaging() {
    for (const row of db.raw
      .prepare("SELECT content FROM extension_imports")
      .all() as { content: string }[]) {
      const s: Session = JSON.parse(row.content);
      if (active.has(s.id) || s.retained === false) continue;
      if (Date.now() - s.created > 24 * 60 * 60_000) {
        await rm(folder(s.id), { recursive: true, force: true });
        s.retained = false;
        if (s.state !== "complete") s.state = "failed";
        s.error = "暂存资源已过期，请重新选择来源";
        save(s);
      } else if (s.retained === undefined) {
        s.retained = !!(await lstat(folder(s.id)).catch(() => null));
        save(s);
      }
    }
  }
  async function rollbackInstall(id: string) {
    const row = db.raw
      .prepare("SELECT content FROM extension_install_journal WHERE id=?")
      .get(id) as { content: string } | undefined;
    if (!row) return;
    const j = JSON.parse(row.content),
      configuredHome = resolve(
        codex.home ||
          codex.extraEnv().CODEX_HOME ||
          process.env.NEWBOT_CODEX_HOME ||
          join(directory, "codex"),
      );
    if (
      !inside(root, j.backup) ||
      !(
        inside(root, j.target) ||
        inside(join(configuredHome, "skills"), j.target)
      ) ||
      !inside(join(configuredHome, "plugins/cache"), j.cache)
    )
      throw new PublicError("安装恢复路径无效");
    await prepareRuntimeIsolation(configuredHome);
    const exists = async (path: string) =>
      !!(await lstat(path).catch(() => null));
    if (await exists(join(j.backup, "asset"))) {
      await rm(j.target, { recursive: true, force: true });
      await rename(join(j.backup, "asset"), j.target);
    } else if (!j.hadTarget)
      await rm(j.target, { recursive: true, force: true });
    if (j.kind === "plugin") {
      if (await exists(join(j.backup, "cache"))) {
        await rm(j.cache, { recursive: true, force: true });
        await mkdir(dirname(j.cache), { recursive: true, mode: 0o700 });
        await rename(join(j.backup, "cache"), j.cache);
      } else if (!j.hadCache)
        await rm(j.cache, { recursive: true, force: true });
    }
    if (j.prior) {
      const p = j.prior;
      db.raw
        .prepare(
          "INSERT OR REPLACE INTO extension_packages VALUES(?,?,?,?,?,?)",
        )
        .run(p.id, p.kind, p.name, p.path, p.digest, p.content);
    } else
      db.raw
        .prepare("DELETE FROM extension_packages WHERE id=?")
        .run(j.entryId);
    if (codex.extensionRuntime) {
      const e = codex.extensionRuntime;
      e.apply(e.revision, [
        {
          keyPath: "skills",
          value: j.settings.skills,
          mergeStrategy: "replace",
        },
        {
          keyPath: "plugins",
          value: j.settings.plugins,
          mergeStrategy: "replace",
        },
      ]);
    }
    db.raw.prepare("DELETE FROM extension_install_journal WHERE id=?").run(id);
    await rm(j.backup, { recursive: true, force: true });
    await writeMarket();
  }
  async function init() {
    await ensureImportDirectory(root);
    await ensureImportDirectory(root, staging);
    for (const row of db.raw
      .prepare("SELECT * FROM extension_native_journal")
      .all() as { id: string; path: string; previous: Uint8Array | null }[]) {
      if (
        dirname(row.path) !==
          resolve(
            codex.home ||
              codex.extraEnv().CODEX_HOME ||
              process.env.NEWBOT_CODEX_HOME ||
              join(directory, "codex"),
          ) ||
        basename(row.path) !== "config.toml"
      )
        throw new PublicError("原生安装恢复记录路径无效");
      await prepareRuntimeIsolation(dirname(row.path));
      if (row.previous === null) await rm(row.path, { force: true });
      else {
        await writeFile(row.path + ".restore", row.previous, { mode: 0o600 });
        await rename(row.path + ".restore", row.path);
      }
      db.raw
        .prepare("DELETE FROM extension_native_journal WHERE id=?")
        .run(row.id);
    }
    for (const row of db.raw
      .prepare("SELECT id FROM extension_install_journal")
      .all() as { id: string }[])
      await rollbackInstall(row.id);
    for (const row of db.raw
      .prepare("SELECT content FROM extension_imports")
      .all() as { content: string }[]) {
      const s: Session = JSON.parse(row.content);
      if (["scanning", "installing"].includes(s.state)) {
        s.state = s.entries.length ? "ready" : "failed";
        s.error = "服务重启中断了操作，请核对结果并重试失败项";
        for (const e of s.entries)
          if (e.state === "available") {
            e.state = "failed";
            e.error = s.error;
          }
        save(s);
      }
    }
    await pruneStaging();
    await new ExtensionResources(db).collect();
    await writeMarket();
  }
  async function create(raw: unknown) {
    const input = sourceInput.parse(raw),
      id = randomUUID();
    const target = input.updatePluginId
      ? packages().find(
          (p) =>
            p.kind === "plugin" &&
            `${p.name}@newbot-imports` === input.updatePluginId &&
            JSON.parse(p.content).installed !== false,
        )
      : undefined;
    if (input.updatePluginId && !target)
      throw new PublicError("升级目标不是已安装的导入插件，请刷新插件目录");
    await pruneStaging();
    const recent = (
      db.raw
        .prepare(
          "SELECT count(*) n FROM extension_imports WHERE json_extract(content,'$.retained')=1",
        )
        .get() as { n: number }
    ).n;
    if (recent >= limits.staging)
      throw new PublicError(
        "最多保留 4 个暂存来源，请完成已有导入或在最近导入中释放资源",
      );
    const source =
      input.kind === "github"
        ? {
            kind: "github" as const,
            ...(await github.resolve(input.url)),
            name: "",
            url: input.url,
          }
        : { kind: input.kind, name: input.name };
    if (source.kind === "github")
      source.name = `${source.owner}/${source.repo}`;
    const s: Session = {
      id,
      source,
      state: "uploading",
      entries: [],
      bytes: 0,
      files: 0,
      created: Date.now(),
      retained: true,
      ...(target
        ? {
            update: {
              pluginId: input.updatePluginId!,
              name: target.name,
              digest: target.digest,
            },
          }
        : {}),
    };
    save(s);
    await ensureImportDirectory(root, join(folder(id), "files"));
    return s;
  }
  async function upload(id: string, path: string, data: Buffer, zip = false) {
    const s = get(id);
    if (s.state !== "uploading" || active.has(id) || s.source.kind === "github")
      throw new PublicError("当前导入不能继续上传");
    if (
      !Buffer.isBuffer(data) ||
      data.length > (zip ? limits.archiveBytes : limits.fileBytes)
    )
      throw new PublicError("上传文件超过大小限制");
    active.add(id);
    try {
      const target = zip
        ? join(folder(id), "source.zip")
        : join(folder(id), "files", importPath(path));
      if (zip !== (s.source.kind === "zip"))
        throw new PublicError("上传类型与来源不一致");
      try {
        const previous = await readFile(target);
        if (previous.equals(data)) return s;
        throw new PublicError("同一路径的文件内容不同，请重新创建导入");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (s.bytes + data.length > limits.totalBytes || s.files >= limits.files)
        throw new PublicError("导入总大小或文件数超出预算");
      await ensureImportDirectory(root, dirname(target));
      await writeFile(target, data, { mode: 0o600, flag: "wx" });
      s.bytes += data.length;
      s.files++;
      save(s);
      return s;
    } finally {
      active.delete(id);
    }
  }
  async function scan(id: string) {
    const s = get(id);
    if (s.state !== "uploading" || active.has(id) || scanning)
      throw new PublicError("当前扫描未就绪或已有扫描正在进行");
    scanning = true;
    active.add(id);
    s.state = "scanning";
    delete s.error;
    save(s);
    try {
      const filesRoot = join(folder(id), "files");
      if (s.source.kind === "github") {
        const g = pinnedGithubSource(s.source);
        const zip = await githubBytes(
          `https://codeload.github.com/${g.owner}/${g.repo}/zip/${g.commit}`,
          limits.archiveBytes,
        );
        await writeFile(join(folder(id), "source.zip"), zip, { mode: 0o600 });
        await extractImportZip(join(folder(id), "source.zip"), filesRoot);
        const dirs = await readdir(filesRoot);
        if (dirs.length !== 1) throw new PublicError("GitHub 包结构异常");
        const selected = join(filesRoot, dirs[0], g.path);
        const tree = await importTree(selected);
        await rename(filesRoot, join(folder(id), "archive"));
        await writeImportTree(filesRoot, tree.files);
        await rm(join(folder(id), "archive"), { recursive: true, force: true });
      } else if (s.source.kind === "zip")
        await extractImportZip(join(folder(id), "source.zip"), filesRoot);
      const tree = await importTree(filesRoot);
      s.bytes = tree.bytes;
      s.files = tree.files.length;
      let entries = await scanNativeImport(
        filesRoot,
        join(root, "probes", id),
        s.source.name,
      );
      const installed = packages();
      if (s.update) {
        const current = installed.find(
          (p) => p.kind === "plugin" && p.name === s.update!.name,
        );
        if (
          !current ||
          current.digest !== s.update.digest ||
          JSON.parse(current.content).installed === false
        )
          throw new PublicError("升级目标已变化，请重新选择来源");
        entries = entries.filter(
          (e) => e.kind === "plugin" && e.name === s.update!.name,
        );
        if (entries.length !== 1)
          throw new PublicError("来源中没有与升级目标同名的完整插件");
      }
      for (const e of entries) {
        let old = installed.find((p) => p.id === e.id);
        if (!old && e.kind === "skills") {
          const matches = installed.filter(
            (p) =>
              p.kind === "skills" &&
              JSON.parse(p.content).skills.some((x: any) =>
                e.skills.some((s) => s.name === x.name),
              ),
          );
          if (matches.length > 1)
            throw new PublicError(
              "技能名称与多个已安装包冲突，请拆分来源后逐包处理",
            );
          if (matches.length === 1) {
            old = matches[0];
            e.id = old.id;
          }
        }
        e.previousDigest =
          old && JSON.parse(old.content).installed !== false
            ? old.digest
            : null;
        if (old && JSON.parse(old.content).installed !== false) {
          const prior = JSON.parse(old.content) as ScannedEntry;
          if (e.digest === old.digest) e.selectedSkills = prior.selectedSkills;
          e.previousVersion = prior.version;
          if (!e.previousVersion && e.kind === "plugin") {
            const declarations = (await importTree(old.path)).files;
            const manifest = declarations.find((f) =>
              [
                "plugin.json",
                ".codex-plugin/plugin.json",
                ".claude-plugin/plugin.json",
              ].includes(f.path),
            );
            if (manifest)
              e.previousVersion = JSON.parse(manifest.data.toString()).version;
          }
          if (e.kind === "plugin") {
            const preferences = await pluginPreferences(old);
            e.previousEnabled = preferences.enabled;
            e.previousSettings = preferences.fingerprint;
            e.selectedSkills = e.skills
              .filter((skill) =>
                preferences.skills.some(
                  (previous) =>
                    previous.name === skill.name && previous.enabled,
                ),
              )
              .map((skill) => skill.id);
          }
          const a = prior.manifest,
            b = e.manifest;
          e.conflict = {
            kind: e.digest === old.digest ? "same" : "changed",
            added: Object.keys(b).filter((k) => !a[k]).length,
            removed: Object.keys(a).filter((k) => !b[k]).length,
            changed: Object.keys(b).filter((k) => a[k] && a[k] !== b[k]).length,
          };
        }
      }
      s.entries = entries;
      s.digest = tree.digest;
      s.state = "ready";
      save(s);
      return s;
    } catch (e) {
      s.state = "failed";
      s.error =
        e instanceof PublicError ? e.message : "扫描失败，请检查包结构或重试";
      save(s);
      throw new PublicError(s.error);
    } finally {
      active.delete(id);
      scanning = false;
    }
  }
  async function install(id: string, raw: unknown) {
    const input = selection.parse(raw),
      s = get(id),
      fingerprint = fileDigest(JSON.stringify(input));
    const oldOp = db.raw
      .prepare("SELECT * FROM extension_import_operations WHERE id=?")
      .get(input.operationId) as
      | { import_id: string; fingerprint: string; state: string }
      | undefined;
    if (oldOp) {
      if (oldOp.import_id !== id || oldOp.fingerprint !== fingerprint)
        throw new PublicError("操作 ID 已用于不同的导入选择");
      return get(id);
    }
    if (
      s.state === "complete" &&
      input.digest === s.digest &&
      input.choices.every((c) =>
        s.entries.some(
          (e) => e.id === c.id && ["installed", "skipped"].includes(e.state),
        ),
      )
    )
      return s;
    if (s.retained === false)
      throw new PublicError("暂存资源已释放，请重新选择来源");
    if (
      !["ready", "complete"].includes(s.state) ||
      active.has(id) ||
      input.digest !== s.digest
    )
      throw new PublicError("扫描结果已变化，请重新扫描");
    if (new Set(input.choices.map((c) => c.id)).size !== input.choices.length)
      throw new PublicError("导入选择不能重复");
    for (const choice of input.choices) {
      const entry = s.entries.find((e) => e.id === choice.id);
      if (
        !entry ||
        choice.skills.some((id) => !entry.skills.some((s) => s.id === id)) ||
        new Set(choice.skills).size !== choice.skills.length
      )
        throw new PublicError("包含未知或重复技能选择");
      if (entry.blocked) throw new PublicError(entry.blocked);
      if (entry.kind === "plugin" && !choice.confirmPackage)
        throw new PublicError("请确认安装完整插件及其工具、钩子范围");
      if (entry.conflict?.kind === "changed" && !choice.replace)
        throw new PublicError("替换已有内容需要明确选择");
    }
    if (codex.runtimeCapabilities?.pinnedPluginRoots)
      return service.publishExtensionAssets(async (core) => {
        const resources = core.extensions!.resources;
        await resources.collect();
        return resources.exclusive(input.choices.map((c) => c.id), async () => {
          if (active.has(id) || get(id).digest !== input.digest) throw new PublicError("导入正在进行或扫描结果已变化");
          active.add(id);
          s.state = "installing";
          delete s.error;
          save(s);
          db.raw.prepare("INSERT INTO extension_import_operations VALUES(?,?,?,?)").run(input.operationId, id, fingerprint, "installing");
          try {
            const tree = await importTree(join(folder(id), "files"));
            if (tree.digest !== s.digest) throw new PublicError("扫描后资源发生变化，请重新导入");
            for (const choice of input.choices) {
              const entry = s.entries.find((e) => e.id === choice.id)!;
              if (["installed", "skipped"].includes(entry.state)) continue;
              let prepared: PreparedResource | undefined;
              try {
                const prior = resources.current(entry.id);
                const installed = prior && JSON.parse(prior.content).installed !== false;
                if (installed && prior.digest === entry.digest) {
                  entry.state = "skipped";
                  save(s);
                  continue;
                }
                if ((installed ? prior.digest : null) !== entry.previousDigest)
                  throw new PublicError("已安装版本与预览不同，请重新扫描");
                prepared = await resources.prepare(entry.id, entryFiles(entry, tree.files));
                if (prepared.digest !== entry.digest) throw new PublicError("安装内容与扫描摘要不一致");
                const preparedPath = prepared.path;
                const pluginId = entry.kind === "plugin" ? `${entry.name}@newbot-imports` : undefined;
                const hookTrust = pluginId ? await confirmedPluginHooks(db.directory, pluginId, prepared.path) : undefined;
                // Revalidate at the final publication boundary; independent installs do not conflict.
                if (installed && pluginId && (await pluginPreferences(prior)).fingerprint !== entry.previousSettings)
                  throw new PublicError("插件启停或技能选择已变化，请重新扫描");
                const choices = entry.skills.map((skill) => ({
                  path: join(preparedPath, entry.root === "." ? skill.path : skill.path.slice(entry.root.length + 1)),
                  enabled: choice.skills.includes(skill.id),
                }));
                const previousPaths = core.extensions!.snapshot().values.skills.config
                  .filter((skill) => prior && skill.path.startsWith(prior.path + "/")).map((skill) => skill.path);
                resources.publish(prepared, {
                  kind: entry.kind, name: entry.name,
                  content: { ...entry, selectedSkills: choice.skills, source: s.source, pluginId, hookTrust },
                }, installed ? prior.digest : null, () => {
                  core.extensions!.setSkills(choices, pluginId, entry.previousEnabled ?? true, previousPaths);
                  entry.state = "installed";
                  entry.selectedSkills = choice.skills;
                  delete entry.error;
                  save(s);
                }, () => core.extensions!.reload());
              } catch (e) {
                entry.state = "failed";
                entry.error = e instanceof PublicError ? e.message : "资源发布失败，请核对后重试失败项";
                save(s);
              } finally {
                if (prepared) await resources.discardPrepared(prepared);
              }
            }
            try { await writeMarket(); }
            catch { s.error = "资源已保存，目录索引刷新失败，请刷新插件目录。"; }
            s.state = "complete";
            if (s.entries.every((e) => ["installed","skipped"].includes(e.state))) {
              await rm(folder(id),{recursive:true,force:true});
              s.retained = false;
            }
            save(s);
            db.raw.prepare("UPDATE extension_import_operations SET state='complete' WHERE id=?").run(input.operationId);
            return get(id);
          } catch(e) {
            s.state = "ready";
            s.error = e instanceof PublicError ? e.message : "导入未完成，请重试";
            save(s);
            db.raw.prepare("UPDATE extension_import_operations SET state='failed' WHERE id=?").run(input.operationId);
            throw e;
          } finally { active.delete(id); }
        });
      });
    return service.mutateExtensionAssets(async (core) => {
      await core.read();
      if (!core.extensions) throw new PublicError("导入需要 SQLite 扩展配置");
      // Compare at commit time, not just when the preview was generated. Another
      // import or a component toggle must not be overwritten by a stale preview.
      for (const choice of input.choices) {
        const entry = s.entries.find((e) => e.id === choice.id)!;
        if (["installed", "skipped"].includes(entry.state)) continue;
        const prior = packages().find(
          (p) => p.id === entry.id && JSON.parse(p.content).installed !== false,
        );
        if (prior?.digest === entry.digest) continue;
        if (
          entry.previousDigest === undefined ||
          (prior?.digest || null) !== entry.previousDigest
        )
          throw new PublicError(
            "已安装内容与扫描时不同，请重新导入并核对升级预览",
          );
        if (
          prior &&
          entry.kind === "plugin" &&
          (await pluginPreferences(prior)).fingerprint !==
            entry.previousSettings
        )
          throw new PublicError("插件启停或技能选择已变化，请重新扫描后升级");
      }
      active.add(id);
      s.state = "installing";
      delete s.error;
      save(s);
      db.raw
        .prepare("INSERT INTO extension_import_operations VALUES(?,?,?,?)")
        .run(input.operationId, id, fingerprint, "installing");
      try {
        const tree = await importTree(join(folder(id), "files"));
        if (tree.digest !== s.digest)
          throw new PublicError("扫描后资源发生变化，请重新导入");
        for (const choice of input.choices) {
          const entry = s.entries.find((e) => e.id === choice.id)!;
          if (["installed", "skipped"].includes(entry.state)) continue;
          const prior = packages().find((p) => p.id === entry.id);
          if (
            prior?.digest === entry.digest &&
            JSON.parse(prior.content).installed !== false
          ) {
            entry.state = "skipped";
            if (entry.kind === "plugin") {
              const current = await pluginPreferences(prior);
              entry.selectedSkills = entry.skills
                .filter((s) =>
                  current.skills.some((p) => p.name === s.name && p.enabled),
                )
                .map((s) => s.id);
            } else
              entry.selectedSkills = JSON.parse(prior.content).selectedSkills;
            delete entry.error;
            save(s);
            continue;
          }
          entry.selectedSkills = choice.skills;
          const replacedPaths =
            prior && entry.kind === "plugin"
              ? (
                  await codex.inspectExtensions(
                    "skills/list",
                    { cwds: [codex.cwd], forceReload: true },
                    { [`${entry.name}@newbot-imports`]: { enabled: true } },
                  )
                ).data
                  .flatMap((d) => d.skills)
                  .filter(
                    (skill) =>
                      skill.pluginId === `${entry.name}@newbot-imports`,
                  )
                  .map((skill) => skill.path)
              : [];
          const oldPath = prior?.path;
          const target =
            entry.kind === "plugin"
              ? join(market, "packages", entry.id, entry.digest)
              : join(codex.home!, "skills", `import-${entry.id.slice(0, 24)}`);
          const stage = join(root, "install", randomUUID()),
            backup = join(root, "backups", randomUUID());
          const journal = randomUUID();
          try {
            if (entry.kind === "plugin" && !service.plugins.enabled())
              throw new PublicError("当前运行时未启用原生插件");
            if (!codex.home) throw new PublicError("原生运行目录不可用");
            await prepareRuntimeIsolation(codex.home);
            const retained = packages().reduce(
                (n, p) => n + (JSON.parse(p.content).bytes || 0),
                0,
              ),
              files = entryFiles(entry, tree.files),
              bytes = files.reduce((n, f) => n + f.data.length, 0);
            if (
              retained -
                (prior ? JSON.parse(prior.content).bytes || 0 : 0) +
                bytes >
              limits.retainedBytes
            )
              throw new PublicError("已安装包超过 256 MiB 资源预算");
            await writeImportTree(stage, files);
            await ensureImportDirectory(
              entry.kind === "plugin" ? root : codex.home,
              dirname(target),
            );
            await ensureImportDirectory(root, backup);
            const cache = join(
                codex.home,
                "plugins/cache/newbot-imports",
                entry.name,
              ),
              hadCache = !!(await lstat(cache).catch(() => null)),
              hadTarget = !!(await lstat(target).catch(() => null));
            if (entry.kind === "plugin" && hadCache)
              await writeImportTree(
                join(backup, "cache"),
                (await importTree(cache, limits.packageBytes)).files,
              );
            db.raw
              .prepare("INSERT INTO extension_install_journal VALUES(?,?)")
              .run(
                journal,
                JSON.stringify({
                  entryId: entry.id,
                  kind: entry.kind,
                  target,
                  backup,
                  cache,
                  hadCache,
                  hadTarget,
                  prior,
                  settings: core.extensions.snapshot().values,
                }),
              );
            if (entry.kind === "skills") {
              try {
                await lstat(target);
                await ensureImportDirectory(root, dirname(backup));
                await rename(target, join(backup, "asset"));
              } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
              }
            } else await rm(target, { recursive: true, force: true });
            await rename(stage, target);
            db.raw
              .prepare(
                "INSERT OR REPLACE INTO extension_packages VALUES(?,?,?,?,?,?)",
              )
              .run(
                entry.id,
                entry.kind,
                entry.name,
                target,
                entry.digest,
                JSON.stringify({
                  ...entry,
                  bytes,
                  source: s.source,
                  installed: true,
                }),
              );
            await writeMarket();
            let pluginId: string | undefined;
            if (entry.kind === "plugin") {
              await nativeMutation(() =>
                codex.call("plugin/install", {
                  marketplacePath: marketFile,
                  pluginName: entry.name,
                }),
              );
              pluginId = `${entry.name}@newbot-imports`;
            }
            const actual = (
              await (pluginId
                ? codex.inspectExtensions(
                    "skills/list",
                    { cwds: [codex.cwd], forceReload: true },
                    { [pluginId]: { enabled: true } },
                  )
                : codex.call("skills/list", {
                    cwds: [codex.cwd],
                    forceReload: true,
                  }))
            ).data.flatMap((d) => d.skills);
            const choices: { path: string; enabled: boolean }[] = [];
            for (const skill of entry.skills) {
              const rel =
                entry.root === "."
                  ? skill.path
                  : skill.path.slice(entry.root.length + 1);
              const found = actual.find((s) =>
                entry.kind === "plugin"
                  ? s.pluginId === pluginId && s.path.endsWith("/" + rel)
                  : s.path === join(target, rel),
              );
              if (!found)
                throw new PublicError(`原生运行时未发现技能：${skill.name}`);
              if (
                fileDigest(await readFile(found.path)) !== entry.manifest[rel]
              )
                throw new PublicError(
                  `原生安装内容与预览不一致：${skill.name}`,
                );
              choices.push({
                path: found.path,
                enabled: choice.skills.includes(skill.id),
              });
            }
            core.extensions.setSkills(
              choices,
              pluginId,
              entry.previousEnabled ?? true,
              replacedPaths,
            );
            entry.state = "installed";
            delete entry.error;
            save(s);
            db.raw
              .prepare("DELETE FROM extension_install_journal WHERE id=?")
              .run(journal);
            await rm(backup, { recursive: true, force: true }).catch(() => {});
            if (entry.kind === "plugin" && oldPath && oldPath !== target)
              await rm(oldPath, { recursive: true, force: true }).catch(
                () => {},
              );
          } catch (e) {
            entry.state = "failed";
            entry.error =
              e instanceof PublicError
                ? e.message
                : "安装失败，请检查原生运行时后重试";
            try {
              await rollbackInstall(journal);
            } catch {
              entry.error += "；安装回滚未确认，重启后会继续恢复";
            }
          } finally {
            await rm(stage, { recursive: true, force: true });
            save(s);
          }
        }
        s.state = "complete";
        if (
          s.entries.every((e) => ["installed", "skipped"].includes(e.state))
        ) {
          await rm(folder(id), { recursive: true, force: true });
          s.retained = false;
        }
        save(s);
        db.raw
          .prepare(
            "UPDATE extension_import_operations SET state='complete' WHERE id=?",
          )
          .run(input.operationId);
        service.events.publish({
          type: "CUSTOM" as any,
          name: "newbot.configuration.changed",
          value: { scope: "extensions" },
        });
        return s;
      } catch (e) {
        s.state = "ready";
        s.error = e instanceof PublicError ? e.message : "导入未完成，请重试";
        save(s);
        db.raw
          .prepare(
            "UPDATE extension_import_operations SET state='failed' WHERE id=?",
          )
          .run(input.operationId);
        throw e;
      } finally {
        active.delete(id);
      }
    });
  }
  return {
    init,
    create,
    get,
    upload,
    scan,
    install,
    list() {
      return (
        db.raw
          .prepare(
            "SELECT content FROM extension_imports ORDER BY COALESCE(json_extract(content,'$.retained'),0) DESC,updated DESC LIMIT 20",
          )
          .all() as { content: string }[]
      ).map((r) => {
        const s = JSON.parse(r.content);
        return {
          id: s.id,
          source: s.source,
          state: s.state,
          created: s.created,
          retained: s.retained,
          update: s.update,
        };
      });
    },
    async discard(id: string) {
      if (active.has(id)) throw new PublicError("操作正在进行，请完成后再关闭");
      const s = get(id);
      if (s.state !== "complete") s.state = "failed";
      s.error = "暂存资源已释放，请重新选择来源";
      s.retained = false;
      save(s);
      await rm(folder(id), { recursive: true, force: true });
    },
    async close() {
      while (active.size) await new Promise((r) => setTimeout(r, 20));
    },
  };
}
export type ExtensionImports = ReturnType<typeof extensionImports>;
