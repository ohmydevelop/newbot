import {
  mkdir,
  rename,
  rm,
  lstat,
  writeFile,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./db.js";
import {
  fileDigest,
  importTree,
  writeImportTree,
  ensureImportDirectory,
  type ImportFile,
} from "./import-files.js";
import { PublicError } from "./public-error.js";
import { IMPORT_LIMITS } from "../shared/imports.js";

export type ResourcePackage = {
  id: string;
  kind: string;
  name: string;
  path: string;
  digest: string;
  content: string;
};
export type PreparedResource = {
  id: string;
  path: string;
  digest: string;
  bytes: number;
};
const resourceStates = new WeakMap<
  Store,
  {
    locks: Set<string>;
    collecting: Set<string>;
  }
>();
/** Content-addressed assets. Publication changes an index, never a running task's files. */
export class ExtensionResources {
  readonly root: string;
  private locks: Set<string>;
  private collecting: Set<string>;
  constructor(private db: Store) {
    this.root = resolve(db.directory, "imports", "marketplace", "versions");
    let state = resourceStates.get(db);
    if (!state) {
      state = { locks: new Set(), collecting: new Set() };
      resourceStates.set(db, state);
    }
    this.locks = state.locks;
    this.collecting = state.collecting;
  }
  packages() {
    return this.db.raw
      .prepare("SELECT * FROM extension_packages")
      .all() as ResourcePackage[];
  }
  current(id: string) {
    return this.db.raw
      .prepare("SELECT * FROM extension_packages WHERE id=?")
      .get(id) as ResourcePackage | undefined;
  }
  /** A package-relative identity survives node paths and package upgrades.
   * Historical version roots remain resolvable while a thread still pins them.
   */
  logicalIdentity(path: string) {
    const roots = [
      ...this.packages().map((p) => ({ id: p.id, path: p.path })),
      ...(this.db.raw
        .prepare("SELECT resource_id id,path FROM extension_resource_versions")
        .all() as { id: string; path: string }[]),
    ].sort((a, b) => b.path.length - a.path.length);
    for (const root of roots) {
      const part = relative(root.path, path);
      if (
        part &&
        !part.startsWith("../") &&
        part !== ".." &&
        !part.startsWith("/")
      )
        return `package:${root.id}:${part}`;
    }
    return undefined;
  }
  plugin(id: string) {
    return this.packages().find(
      (p) =>
        p.kind === "plugin" &&
        (JSON.parse(p.content).pluginId || `${p.name}@newbot-imports`) === id,
    );
  }
  pins() {
    return Object.fromEntries(
      this.packages()
        .filter(
          (p) =>
            p.kind === "plugin" && JSON.parse(p.content).installed !== false,
        )
        .map((p) => [
          JSON.parse(p.content).pluginId || `${p.name}@newbot-imports`,
          { local_root: p.path },
        ]),
    );
  }
  skillRoots() {
    return this.packages()
      .filter(
        (p) => p.kind === "skills" && JSON.parse(p.content).installed !== false,
      )
      .map((p) => p.path);
  }
  skillAvailable(path: string) {
    const current = this.packages().find(
      (p) => p.kind === "skills" && path.startsWith(p.path + "/"),
    );
    if (current) {
      const content = JSON.parse(current.content);
      return (
        content.installed !== false &&
        !(content.removedSkills || []).includes(relative(current.path, path))
      );
    }
    if (path.startsWith(this.root + "/")) return false;
    const legacy = /\/skills\/import-([a-f0-9]{24})\//.exec(path);
    return !legacy || !this.packages().some((p) => p.id.startsWith(legacy[1]));
  }
  removeSkill(path: string) {
    const pkg = this.packages().find(
      (p) => p.kind === "skills" && path.startsWith(p.path + "/"),
    );
    if (!pkg) throw new PublicError("技能不属于已安装资源");
    const content = JSON.parse(pkg.content);
    content.removedSkills = [
      ...new Set([...(content.removedSkills || []), relative(pkg.path, path)]),
    ];
    this.db.raw
      .prepare("UPDATE extension_packages SET content=? WHERE id=?")
      .run(JSON.stringify(content), pkg.id);
  }
  async catalog(pkg: ResourcePackage, marketplace: string) {
    const root = dirname(pkg.path);
    const path = join(root, ".agents/plugins/marketplace.json");
    await ensureImportDirectory(this.root, dirname(path));
    const content = JSON.stringify({
      name: marketplace,
      plugins: [
        {
          name: pkg.name,
          source: { source: "local", path: "./" + relative(root, pkg.path) },
        },
      ],
    });
    try {
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code !== "EEXIST" ||
        (await readFile(path, "utf8")) !== content
      )
        throw e;
    }
    return path;
  }
  async exclusive<T>(ids: string[], work: () => Promise<T>) {
    const keys = [...new Set(ids)].sort();
    if (keys.some((id) => this.locks.has(id)))
      throw new PublicError("此资源正在修改，请等待结果后重试");
    keys.forEach((id) => this.locks.add(id));
    try {
      return await work();
    } finally {
      keys.forEach((id) => this.locks.delete(id));
    }
  }
  async prepare(id: string, files: ImportFile[]): Promise<PreparedResource> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new PublicError("资源标识无效");
    const digest = fileDigest(
      files.map((f) => `${f.path}\0${f.mode}\0${f.sha256}`).join("\n"),
    );
    const bytes = files.reduce((n, f) => n + f.data.length, 0);
    if (bytes > IMPORT_LIMITS.packageBytes)
      throw new PublicError("资源包超过大小限制");
    const parent = join(this.root, id, digest),
      path = join(parent, "package");
    await ensureImportDirectory(this.root, parent);
    const existing = await lstat(path).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (existing) {
      if (
        (await importTree(path, IMPORT_LIMITS.packageBytes)).digest !== digest
      )
        throw new PublicError("已保存资源校验失败，原版本未被覆盖");
    } else {
      const stage = join(parent, `.stage-${randomUUID()}`);
      try {
        await writeImportTree(stage, files);
        await rename(stage, path);
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }
    return { id, path, digest, bytes };
  }
  /** No await inside publication. Other package changes do not invalidate this CAS. */
  publish(
    prepared: PreparedResource,
    data: { kind: string; name: string; content: object },
    expectedDigest: string | null,
    preferences: () => void,
    restorePreferences: () => void = () => {},
  ) {
    if (this.collecting.has(prepared.path))
      throw new PublicError("此资源版本正在清理，请重新扫描");
    const current = this.current(prepared.id);
    const activeDigest =
      current && JSON.parse(current.content).installed !== false
        ? current.digest
        : null;
    if (activeDigest !== expectedDigest)
      throw new PublicError("此资源已被更新，请重新扫描并确认");
    const retained = (
      this.db.raw
        .prepare(
          "SELECT coalesce(sum(bytes),0) total FROM extension_resource_versions",
        )
        .get() as { total: number }
    ).total;
    const exists = this.db.raw
      .prepare(
        "SELECT 1 FROM extension_resource_versions WHERE resource_id=? AND digest=?",
      )
      .get(prepared.id, prepared.digest);
    if (retained + (exists ? 0 : prepared.bytes) > IMPORT_LIMITS.retainedBytes)
      throw new PublicError(
        "已保存资源版本超过 256 MiB 预算，请先清理不再使用的资源",
      );
    const content = JSON.stringify({
      ...data.content,
      bytes: prepared.bytes,
      installed: true,
    });
    this.db.raw.exec("SAVEPOINT publish_extension");
    try {
      this.db.raw
        .prepare(
          "INSERT OR IGNORE INTO extension_resource_versions VALUES(?,?,?,?,?,?)",
        )
        .run(
          prepared.id,
          prepared.digest,
          prepared.path,
          prepared.bytes,
          content,
          Date.now(),
        );
      this.db.raw
        .prepare(
          "INSERT OR REPLACE INTO extension_packages VALUES(?,?,?,?,?,?)",
        )
        .run(
          prepared.id,
          data.kind,
          data.name,
          prepared.path,
          prepared.digest,
          content,
        );
      preferences();
      this.db.raw.exec("RELEASE publish_extension");
    } catch (e) {
      this.db.raw.exec(
        "ROLLBACK TO publish_extension; RELEASE publish_extension",
      );
      restorePreferences();
      throw e;
    }
  }
  pin(
    owner: string,
    snapshot: {
      config?: any;
      resources?: { resourceRoot?: string; path: string }[];
    },
  ) {
    const roots = new Set<string>([
      ...Object.values(snapshot.config?.plugins || {})
        .filter((p: any) => p.enabled)
        .map((p: any) => p.local_root)
        .filter(Boolean),
      ...(snapshot.resources || [])
        .map((p) => p.resourceRoot)
        .filter((p): p is string => !!p),
    ]);
    // Keep every version a durable thread has used, including resources for old App views.
    for (const path of roots) {
      if (this.collecting.has(path))
        throw new PublicError("此资源版本已过期，请重新选择扩展");
      const added = this.db.raw
        .prepare(
          `INSERT OR IGNORE INTO extension_resource_refs
        SELECT ?,resource_id,digest FROM extension_resource_versions WHERE path=?`,
        )
        .run(owner, path);
      if (
        !added.changes &&
        path.startsWith(this.root + "/") &&
        !this.db.raw
          .prepare("SELECT 1 FROM extension_resource_versions WHERE path=?")
          .get(path)
      )
        throw new PublicError("此资源版本已不可用，请重新选择扩展");
    }
  }
  retire(id: string) {
    const current = this.current(id);
    if (current)
      this.db.raw
        .prepare("UPDATE extension_packages SET content=? WHERE id=?")
        .run(
          JSON.stringify({ ...JSON.parse(current.content), installed: false }),
          id,
        );
  }
  async discardPrepared(prepared: PreparedResource) {
    if (
      prepared.path !== join(this.root, prepared.id, prepared.digest, "package")
    )
      throw new PublicError("资源准备路径无效");
    if (
      this.current(prepared.id)?.path === prepared.path ||
      this.db.raw
        .prepare(
          "SELECT 1 FROM extension_resource_versions WHERE resource_id=? AND digest=?",
        )
        .get(prepared.id, prepared.digest)
    )
      return;
    await ensureImportDirectory(this.root, dirname(prepared.path));
    await rm(dirname(prepared.path), { recursive: true, force: true });
  }
  async collect() {
    // A grace period covers in-flight catalog reads. Durable references always win.
    const rows = this.db.raw
      .prepare(
        `SELECT v.* FROM extension_resource_versions v
      WHERE v.created<? AND NOT EXISTS(SELECT 1 FROM extension_resource_refs r WHERE r.resource_id=v.resource_id AND r.digest=v.digest)
      AND NOT EXISTS(SELECT 1 FROM extension_packages p WHERE p.id=v.resource_id AND p.digest=v.digest AND coalesce(json_extract(p.content,'$.installed'),1)!=0)`,
      )
      .all(Date.now() - 86400_000) as {
      resource_id: string;
      digest: string;
      path: string;
    }[];
    for (const row of rows) {
      if (
        this.locks.has(row.resource_id) ||
        row.path !== join(this.root, row.resource_id, row.digest, "package")
      )
        continue;
      await this.exclusive([row.resource_id], async () => {
        const current = this.current(row.resource_id);
        if (
          current?.digest === row.digest &&
          JSON.parse(current.content).installed !== false
        )
          return;
        if (
          this.db.raw
            .prepare(
              "SELECT 1 FROM extension_resource_refs WHERE resource_id=? AND digest=?",
            )
            .get(row.resource_id, row.digest)
        )
          return;
        this.collecting.add(row.path);
        try {
          await ensureImportDirectory(this.root, dirname(row.path));
          await rm(dirname(row.path), { recursive: true, force: true });
          this.db.raw
            .prepare(
              "DELETE FROM extension_resource_versions WHERE resource_id=? AND digest=?",
            )
            .run(row.resource_id, row.digest);
        } finally {
          this.collecting.delete(row.path);
        }
      });
    }
    // A crash between preparing files and publishing the index can leave an
    // unregistered directory. Never follow links or touch a recent/in-use package.
    const packages = await readdir(this.root, { withFileTypes: true }).catch(
      (e) => {
        if (e.code === "ENOENT") return [];
        throw e;
      },
    );
    for (const pkg of packages) {
      if (
        !pkg.isDirectory() ||
        !/^[a-f0-9]{64}$/.test(pkg.name) ||
        this.locks.has(pkg.name)
      )
        continue;
      await ensureImportDirectory(this.root, join(this.root, pkg.name));
      for (const version of await readdir(join(this.root, pkg.name), {
        withFileTypes: true,
      })) {
        if (
          !version.isDirectory() ||
          !/^[a-f0-9]{64}$/.test(version.name) ||
          this.locks.has(pkg.name)
        )
          continue;
        await this.exclusive([pkg.name], async () => {
          const parent = join(this.root, pkg.name, version.name);
          const info = await lstat(parent).catch((e) => {
            if (e.code === "ENOENT") return null;
            throw e;
          });
          if (
            !info?.isDirectory() ||
            info.isSymbolicLink() ||
            Date.now() - info.mtimeMs < 86400_000 ||
            (await realpath(parent)) !== parent
          )
            return;
          if (
            this.db.raw
              .prepare(
                "SELECT 1 FROM extension_resource_versions WHERE resource_id=? AND digest=?",
              )
              .get(pkg.name, version.name)
          )
            return;
          // Also protect migrated or recovered package indexes not yet in the version table.
          const current = this.current(pkg.name);
          if (current?.path === join(parent, "package")) return;
          this.collecting.add(join(parent, "package"));
          try {
            await rm(parent, { recursive: true, force: true });
          } finally {
            this.collecting.delete(join(parent, "package"));
          }
        });
      }
    }
  }
}
