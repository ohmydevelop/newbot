import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  expertSave,
  type Expert,
  type ExpertMembers,
  type ExpertReference,
  type SessionExtensions,
} from "../shared/experts.js";
import type { Store } from "./db.js";
import type { skillLibrary } from "./skills.js";
import type { pluginLibrary } from "./plugins.js";
import type { configuration } from "./configuration.js";
import type { Thread, SkillSelection } from "../shared/types.js";
import { PublicError } from "./public-error.js";
import { skillPlugin } from "./plugin-ownership.js";
type Row = {
  id: string;
  revision: number;
  name: string;
  description: string;
  content: string;
};
export function expertContextText(
  expert: ExpertReference & { instructions?: string },
  connectorIds: string[],
) {
  return `本轮使用专家“${expert.name}”。${connectorIds.length ? `可使用已连接的工具服务：${connectorIds.join("、")}。` : ""}${expert.instructions ? `\n\n${expert.instructions}` : ""}`;
}
export function experts(
  db: Store,
  skills: ReturnType<typeof skillLibrary>,
  plugins: ReturnType<typeof pluginLibrary>,
  config: ReturnType<typeof configuration>,
) {
  const get = (id: string) =>
    db.raw.prepare("SELECT * FROM experts WHERE id=?").get(id) as
      | Row
      | undefined;
  const dto = (row: Row) => {
    const value = {
      id: row.id,
      name: row.name,
      revision: row.revision,
      description: row.description,
      instructions: "",
      ...JSON.parse(row.content),
    } as Expert;
    value.pluginIds = [
      ...new Set([
        ...value.pluginIds,
        ...value.skillIds.flatMap((id) => skillPlugin(db, id) || []),
      ]),
    ];
    value.skillIds = value.skillIds.filter((id) => !skillPlugin(db, id));
    return value;
  };
  async function catalog() {
    const [s, p, c] = await Promise.all([
      skills.list(),
      plugins.list(),
      config.read(),
    ]);
    return {
      skills: s.skills,
      plugins: p.entries,
      connectors: c.publicView.mcp,
    };
  }
  function problems(
    expert: ExpertMembers,
    entries: Awaited<ReturnType<typeof catalog>>,
  ) {
    const errors: string[] = [];
    for (const id of expert.skillIds) {
      const s = entries.skills.find(
        (s) => s.id === (config.extensions?.resolveAlias(id) || id),
      );
      if (!s) errors.push("某个技能已移除");
      else if (!s.enabled)
        errors.push(`技能“${s.interface?.displayName || s.name}”已停用`);
    }
    for (const id of expert.pluginIds) {
      const p = entries.plugins.find((p) => p.id === id);
      if (!p?.installed) errors.push("某个插件未安装或已移除");
      else if (!p.enabled || !p.available)
        errors.push(`插件“${p.displayName}”不可用`);
    }
    for (const id of expert.connectorIds) {
      const c = entries.connectors.find((c) => c.id === id);
      if (!c) errors.push(`连接器“${id}”已移除`);
      else if (!c.enabled) errors.push(`连接器“${id}”已停用`);
    }
    return errors;
  }
  async function list() {
    const entries = await catalog();
    return {
      entries: (
        db.raw
          .prepare("SELECT * FROM experts ORDER BY updated DESC")
          .all() as Row[]
      ).map((row) => {
        const e = dto(row),
          issues = problems(e, entries);
        return { ...e, available: !issues.length, problems: issues };
      }),
      catalog: {
        skills: entries.skills
          .filter((s) => !s.pluginId)
          .map((s) => ({
            id: s.id,
            name: s.interface?.displayName || s.name,
            enabled: s.enabled,
          })),
        plugins: entries.plugins
          .filter((p) => p.installed)
          .map((p) => ({
            id: p.id,
            name: p.displayName,
            enabled: p.enabled && p.available,
          })),
        connectors: entries.connectors.map((c) => ({
          id: c.id,
          name: c.id,
          enabled: c.enabled,
        })),
      },
    };
  }
  async function read(id: string) {
    const row = get(id);
    if (!row) throw new PublicError("专家已移除，请重新选择");
    const entries = await catalog(),
      e = dto(row),
      issues = problems(e, entries);
    return { ...e, available: !issues.length, problems: issues };
  }
  async function save(input: unknown) {
    const p = expertSave.parse(input),
      old = p.id ? get(p.id) : undefined;
    if (p.id && (!old || old.revision !== p.expectedRevision))
      throw new PublicError("专家已变化，请重新读取");
    // Older clients do not send this new field; preserve a saved prompt unless explicitly edited.
    if (old && !Object.hasOwn(input as object, "instructions"))
      p.instructions = dto(old).instructions || "";
    const entries = await catalog();
    for (const id of p.skillIds) {
      const owner = skillPlugin(db, id);
      if (owner && !p.pluginIds.includes(owner)) p.pluginIds.push(owner);
    }
    p.skillIds = p.skillIds.filter((id) => !skillPlugin(db, id));
    if (p.pluginIds.length > 8) throw new PublicError("专家最多包含 8 个插件");
    if (
      p.skillIds.some((id) => !entries.skills.some((s) => s.id === id)) ||
      p.pluginIds.some(
        (id) => !entries.plugins.some((s) => s.id === id && s.installed),
      ) ||
      p.connectorIds.some((id) => !entries.connectors.some((s) => s.id === id))
    )
      throw new PublicError("所选扩展已移除，请刷新目录后重新选择");
    const id = p.id || randomUUID(),
      revision = (old?.revision || 0) + 1,
      content = JSON.stringify({
        instructions: p.instructions,
        skillIds: [...new Set(p.skillIds)],
        pluginIds: [...new Set(p.pluginIds)],
        connectorIds: [...new Set(p.connectorIds)],
      });
    if (old) {
      const changed = db.raw
        .prepare(
          "UPDATE experts SET name=?,description=?,revision=?,content=?,updated=? WHERE id=? AND revision=?",
        )
        .run(
          p.name,
          p.description,
          revision,
          content,
          Date.now(),
          id,
          old.revision,
        );
      if (!changed.changes) throw new PublicError("专家已变化，请重新读取");
    } else
      db.raw
        .prepare("INSERT INTO experts VALUES(?,?,?,?,?,?)")
        .run(id, revision, p.name, p.description, content, Date.now());
    return read(id);
  }
  function remove(input: unknown) {
    const p = z
      .strictObject({
        id: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
      })
      .parse(input);
    const r = db.raw
      .prepare("DELETE FROM experts WHERE id=? AND revision=?")
      .run(p.id, p.expectedRevision);
    if (!r.changes) throw new PublicError("专家已变化，请重新读取");
    return {};
  }
  function session(threadId: string): SessionExtensions {
    const row = db.raw
      .prepare(
        "SELECT revision,expert_id FROM session_extensions WHERE thread_id=?",
      )
      .get(threadId) as
      | { revision: number; expert_id: string | null }
      | undefined;
    const e = row?.expert_id ? get(row.expert_id) : undefined;
    return {
      revision: row?.revision || 0,
      expertId: row?.expert_id || null,
      expert: e ? { id: e.id, name: e.name, revision: e.revision } : null,
      missing: !!row?.expert_id && !e,
    };
  }
  function attach(threadId: string, expertId?: string | null) {
    db.raw
      .prepare("INSERT OR IGNORE INTO session_extensions VALUES(?,0,?)")
      .run(threadId, expertId || null);
  }
  async function update(input: unknown) {
    const p = z
      .strictObject({
        threadId: z.string().min(1).max(200),
        expectedRevision: z.number().int().nonnegative(),
        expertId: z.string().uuid().nullable(),
      })
      .parse(input);
    if (!db.owns(p.threadId)) throw new PublicError("会话不存在");
    const before = session(p.threadId);
    if (before.revision !== p.expectedRevision)
      throw new PublicError("会话专家已变化，请重新读取");
    if (p.expertId) {
      const e = await read(p.expertId);
      if (!e.available) throw new PublicError(e.problems.join("；"));
    }
    attach(p.threadId);
    const r = db.raw
      .prepare(
        "UPDATE session_extensions SET expert_id=?,revision=revision+1 WHERE thread_id=? AND revision=?",
      )
      .run(p.expertId, p.threadId, before.revision);
    if (!r.changes) throw new PublicError("会话专家已变化，请重新读取");
    return session(p.threadId);
  }
  async function capture(p: {
    threadId?: string;
    expertId?: string | null;
    extensionRevision?: number;
    skills?: SkillSelection[];
    plugins?: string[];
  }) {
    const bound = p.threadId ? session(p.threadId) : null;
    if (
      bound &&
      ((p.extensionRevision !== undefined &&
        p.extensionRevision !== bound.revision) ||
        (p.expertId !== undefined && p.expertId !== bound.expertId))
    )
      throw new PublicError("会话专家已变化，请重新读取后发送");
    const id = bound?.expertId || (!bound ? p.expertId : null),
      selectedSkills = [...(p.skills || [])].filter(
        (s) => !skillPlugin(db, s.id),
      ),
      selectedPlugins = [
        ...new Set([
          ...(p.plugins || []),
          ...(p.skills || []).flatMap((s) => skillPlugin(db, s.id) || []),
        ]),
      ];
    if (selectedPlugins.length > 8)
      throw new PublicError("本轮最多引用 8 个插件");
    if (!id)
      return {
        skills: selectedSkills,
        plugins: selectedPlugins,
        expertId: null,
        expertSnapshot: null,
        connectorIds: [],
        extensionRevision: bound?.revision || 0,
      };
    const e = await read(id);
    if (!e.available) throw new PublicError(e.problems.join("；"));
    for (const id of e.skillIds) {
      const d = await skills.read(id);
      if (!selectedSkills.some((s) => s.id === d.skill.id))
        selectedSkills.push({ id: d.skill.id, sha256: d.sha256 });
    }
    for (const id of e.pluginIds)
      if (!selectedPlugins.includes(id)) selectedPlugins.push(id);
    if (selectedSkills.length > 8 || selectedPlugins.length > 8)
      throw new PublicError("专家与本轮引用合计最多 8 个技能和 8 个插件");
    return {
      skills: selectedSkills,
      plugins: selectedPlugins,
      expertId: e.id,
      expertSnapshot: {
        id: e.id,
        name: e.name,
        revision: e.revision,
        instructions: e.instructions || "",
      },
      connectorIds: e.connectorIds,
      extensionRevision: bound?.revision || 0,
    };
  }
  function bind(requestId: string, expert: ExpertReference | null) {
    if (expert)
      db.raw
        .prepare("INSERT OR IGNORE INTO run_experts VALUES(?,?,?,?)")
        .run(requestId, expert.id, expert.name, expert.revision);
  }
  function decorate(thread: Thread) {
    thread.extensions = session(thread.id);
    const rows = db.raw
      .prepare(
        "SELECT r.client_message_id,r.turn_id,e.expert_id,e.name,e.revision,c.context FROM runs r JOIN run_experts e ON e.request_id=r.request_id LEFT JOIN run_context c ON c.request_id=r.request_id WHERE r.thread_id=?",
      )
      .all(thread.id) as any[];
    for (const turn of thread.turns)
      for (const item of turn.items)
        if (item.type === "userMessage") {
          const r = rows.find(
            (r) =>
              r.client_message_id === (item.clientId || item.id) ||
              (!item.clientId &&
                r.turn_id === turn.id &&
                turn.items.find((i) => i.type === "userMessage")?.id ===
                  item.id),
          );
          if (r) {
            item.expert = {
              id: r.expert_id,
              name: r.name,
              revision: r.revision,
            };
            const context = r.context ? JSON.parse(r.context) : null;
            if (
              context?.connectorIds?.length ||
              context?.expertSnapshot?.instructions
            ) {
              const generated = expertContextText(
                context.expertSnapshot || item.expert,
                context.connectorIds || [],
              );
              // This extra input belongs to the recorded expert, not the user's composed message.
              item.content = item.content?.filter(
                (part, index) =>
                  index !== (context.expertContextInputIndex ?? 1) ||
                  part.type !== "text" ||
                  part.text !== generated,
              );
            }
          }
        }
    return thread;
  }
  return {
    list,
    read,
    save,
    remove,
    session,
    attach,
    update,
    capture,
    bind,
    decorate,
    unbind: (requestId: string) =>
      db.raw
        .prepare("DELETE FROM run_experts WHERE request_id=?")
        .run(requestId),
  };
}
