import { PublicError } from "./public-error.js";
import { z } from "zod";
import type { UserInput } from "../generated/codex/v2/UserInput.js";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, mkdir, rename } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
} from "node:path";
import type { Codex } from "./codex.js";
import type {
  Skill,
  SkillDocument,
  SkillSelection,
  SkillReference,
} from "../shared/types.js";
export const skillSelections = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-f0-9]{64}$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  )
  .max(8)
  .refine(
    (items) => new Set(items.map((s) => s.id)).size === items.length,
    "技能不能重复选择",
  );
export const MAX_SKILL_BYTES = 256 * 1024;
export const skillId = (path: string) =>
  createHash("sha256").update(path).digest("hex");
class SkillReadError extends PublicError {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}
function reject(message: string, status = 403): never {
  throw new SkillReadError(message, status);
}
async function directories(path: string) {
  let current = parse(path).root;
  for (const part of relative(current, path).split("/").filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      reject("技能说明路径包含链接或非目录，暂不支持查看");
  }
}
async function readDocument(path: string) {
  if (
    !isAbsolute(path) ||
    normalize(path) !== path ||
    basename(path) !== "SKILL.md"
  )
    reject("此技能未提供可读取的本地说明文件");
  await directories(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    reject("技能说明必须是普通文件，链接文件暂不支持查看");
  if (before.size > MAX_SKILL_BYTES)
    reject("技能说明超过 256 KiB 查看上限，请在服务端检查文件", 413);
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      reject("技能说明在读取时发生变化，请重新读取", 409);
    if (
      process.platform === "linux" &&
      (await realpath(`/proc/self/fd/${handle.fd}`)) !== path
    )
      reject("技能说明路径已变化，请刷新技能列表后重试", 409);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const next = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!next.bytesRead) break;
      offset += next.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(path);
    await directories(dirname(path));
    if (
      offset !== before.size ||
      [after, current].some(
        (s) =>
          !s.isFile() ||
          s.nlink !== 1 ||
          s.dev !== before.dev ||
          s.ino !== before.ino ||
          s.size !== before.size ||
          s.mtimeMs !== before.mtimeMs ||
          s.ctimeMs !== before.ctimeMs,
      ) ||
      (await realpath(path)) !== path
    )
      reject("技能说明在读取时发生变化，请重新读取", 409);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      reject("技能说明不是有效的 UTF-8 文本，暂不支持查看", 415);
    }
    if (content.includes("\0"))
      reject("技能说明包含非文本内容，暂不支持查看", 415);
    return {
      content,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await handle.close();
  }
}
export function skillLibrary(codex: Codex, cwd: string) {
  function removal(skill: {
    path: string;
    scope: string;
    pluginId?: string | null;
  }) {
    if (skill.pluginId)
      return { removable: false, removalReason: "请在所属插件中管理此技能" };
    if (codex.extensionRuntime?.resources.packages().some((p) => p.kind === "skills" && skill.path.startsWith(p.path + "/")))
      return { removable: true, removalReason: null };
    if (skill.scope !== "user")
      return {
        removable: false,
        removalReason: "此技能由项目、系统或管理员管理",
      };
    const folder = dirname(skill.path),
      root = dirname(folder);
    const roots = [
      codex.home && join(codex.home, "skills"),
      codex.userHome && join(codex.userHome, ".agents", "skills"),
    ].filter(Boolean);
    if (
      !roots.includes(root) ||
      basename(folder).startsWith(".") ||
      basename(skill.path) !== "SKILL.md"
    )
      return {
        removable: false,
        removalReason: "此技能不在可管理的个人技能目录中",
      };
    return { removable: true, removalReason: null };
  }
  async function list() {
    if (codex.state !== "ready")
      reject("技能列表暂不可用，请等待 Codex 就绪后重试", 503);
    try {
      const result = await codex.call("skills/list", {
        cwds: [cwd],
        forceReload: true,
      });
      const skills = [
        ...new Map(
          result.data
            .flatMap((entry) => entry.skills)
            .filter((skill) => skill.pluginId || codex.extensionRuntime?.resources.skillAvailable(skill.path) !== false)
            .map((skill) => [
              skill.path,
              {
                ...skill,
                id: codex.extensionRuntime?.asset(skill) || skillId(skill.path),
                enabled:
                  !(
                    skill.pluginId &&
                    codex.extensionRuntime?.pluginEnabled(
                      skill.pluginId,
                      true,
                    ) === false
                  ) &&
                  (codex.extensionRuntime?.skillEnabled(
                    skill.path,
                    skill.enabled,
                  ) ??
                    skill.enabled),
                ...removal(skill),
              },
            ]),
        ).values(),
      ] satisfies Skill[];
      return {
        skills,
        hiddenPaths: result.data.flatMap((entry) => entry.skills).filter((s) => !s.pluginId && codex.extensionRuntime?.resources.skillAvailable(s.path) === false).map((s) => s.path),
        warnings: result.data.reduce(
          (sum, entry) => sum + entry.errors.length,
          0,
        ),
      };
    } catch (error) {
      if (error instanceof SkillReadError) throw error;
      reject("技能列表读取失败，请刷新或检查 Codex 状态", 503);
    }
  }
  async function read(id: string): Promise<SkillDocument> {
    if (!/^[a-f0-9]{64}$/.test(id)) reject("技能标识无效，请刷新技能列表", 400);
    const { skills } = await list();
    const skill = skills.find(
      (entry) => entry.id === (codex.extensionRuntime?.resolveAlias(id) || id),
    );
    if (!skill) reject("技能已不在当前列表中，请刷新后重试", 404);
    return readCurrent(skill);
  }
  async function readCurrent(skill: Skill): Promise<SkillDocument> {
    try {
      return { skill, ...(await readDocument(skill.path)) };
    } catch (error) {
      if (error instanceof SkillReadError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ENOTDIR")
        reject("技能说明文件已失效，请刷新技能列表后重试", 410);
      if (code === "EACCES" || code === "EPERM")
        reject("暂无权限读取此技能说明", 403);
      reject("技能说明读取失败，请刷新技能列表后重试", 409);
    }
  }
  async function prepare(selected: SkillSelection[]) {
    const selections = skillSelections.parse(selected);
    if (!selections.length)
      return { inputs: [] as UserInput[], references: [] as SkillReference[] };
    const { skills } = await list();
    const documents = await Promise.all(
      selections.map(async (selection) => {
        const skill = skills.find(
          (s) =>
            s.id ===
            (codex.extensionRuntime?.resolveAlias(selection.id) ||
              selection.id),
        );
        if (!skill) reject("所选技能已不在当前列表中，请移除后重新选择", 409);
        if (!skill.enabled)
          reject("所选技能已停用，请移除或启用后重新选择", 409);
        const document = await readCurrent(skill);
        if (document.sha256 !== selection.sha256)
          reject("所选技能说明已变化，请移除后重新查看并选择", 409);
        return document;
      }),
    );
    return {
      inputs: documents.map(
        ({ skill }): UserInput => ({
          type: "skill",
          name: skill.name,
          path: skill.path,
        }),
      ),
      references: documents.map(
        ({ skill, sha256 }): SkillReference => ({
          id: skill.id,
          name: skill.name,
          displayName: skill.interface?.displayName || skill.name,
          scope: skill.scope,
          sha256,
        }),
      ),
    };
  }
  async function uninstall(id: string, sha256: string) {
    const document = await read(id);
    if (!document.skill.removable)
      reject(document.skill.removalReason || "此技能无法卸载");
    if (sha256 !== document.sha256)
      reject("技能内容已变化，请重新查看后确认", 409);
    if (codex.runtimeCapabilities?.pinnedPluginRoots && codex.extensionRuntime?.resources.packages().some((p) => p.kind === "skills" && document.skill.path.startsWith(p.path + "/"))) {
      codex.extensionRuntime.setSkill(document.skill.path,false);
      codex.extensionRuntime.resources.removeSkill(document.skill.path);
      return {state:"uninstalled",...(await list())};
    }
    const folder = dirname(document.skill.path),
      root = dirname(folder);
    await directories(folder);
    const before = await lstat(folder);
    if (!before.isDirectory() || before.isSymbolicLink())
      reject("技能目录已变化", 409);
    const archive = join(dirname(root), "newbot-removed-skills");
    await mkdir(archive, { recursive: true, mode: 0o700 });
    await directories(archive);
    if (codex.extensionRuntime)
      codex.extensionRuntime.setSkill(document.skill.path, false);
    else
      await codex.call("skills/config/write", {
        path: document.skill.path,
        enabled: false,
      });
    const current = await lstat(folder);
    if (
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.isSymbolicLink()
    )
      reject("技能目录已变化，请刷新确认", 409);
    await rename(folder, join(archive, `${basename(folder)}-${randomUUID()}`));
    for (const threadId of [...codex.loaded]) await codex.unload(threadId);
    return { state: "uninstalled", ...(await list()) };
  }
  return { list, read, readCurrent, prepare, uninstall };
}
