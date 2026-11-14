import { z } from "zod";
import type { Store } from "./db.js";
import type { skillLibrary } from "./skills.js";
import type { pluginLibrary } from "./plugins.js";
import { skillSelections } from "./skills.js";
import type {
  SessionInputs,
  SkillSelection,
  SkillReference,
} from "../shared/types.js";
import { PublicError } from "./public-error.js";
import { unifyPluginInputs, skillPlugin } from "./plugin-ownership.js";

export function sessionInputs(
  db: Store,
  skills: ReturnType<typeof skillLibrary>,
  plugins: ReturnType<typeof pluginLibrary>,
  changed: (threadId: string, value: SessionInputs) => void,
) {
  function get(threadId: string): SessionInputs {
    const row = db.raw
      .prepare("SELECT revision,content FROM session_inputs WHERE thread_id=?")
      .get(threadId) as { revision: number; content: string } | undefined;
    const value: SessionInputs = row
      ? { ...JSON.parse(row.content), revision: row.revision }
      : { revision: 0, skills: [], plugins: [] };
    // Older dispatches stored only id/hash. Recover the exact version's label,
    // never replace a selection with the current catalog's possibly newer file.
    value.skills = value.skills.map((ref) => {
      if (ref.name && ref.displayName && ref.scope) return ref;
      const saved = db.raw
        .prepare(
          `SELECT s.name,s.display_name AS displayName,s.scope
        FROM run_skills s JOIN runs r ON r.request_id=s.request_id
        WHERE r.thread_id=? AND s.skill_id=? AND s.sha256=?
        ORDER BY r.created DESC LIMIT 1`,
        )
        .get(threadId, ref.id, ref.sha256) as
        | Pick<SkillReference, "name" | "displayName" | "scope">
        | undefined;
      return saved ? { ...ref, ...saved } : ref;
    });
    return unifyPluginInputs(db, value);
  }
  async function update(input: unknown) {
    const p = z
      .object({
        threadId: z.string().min(1).max(200),
        expectedRevision: z.number().int().nonnegative(),
        skills: skillSelections,
        plugins: z.array(z.string().min(1).max(200)).max(8),
      })
      .parse(input);
    if (!db.owns(p.threadId)) throw new PublicError("会话不存在");
    const before = get(p.threadId);
    for (const s of p.skills) {
      const owner = skillPlugin(db, s.id);
      if (owner && !p.plugins.includes(owner)) p.plugins.push(owner);
    }
    p.skills = p.skills.filter((s) => !skillPlugin(db, s.id));
    if (p.plugins.length > 8)
      throw new PublicError("下一条消息最多引用 8 个插件");
    if (before.revision !== p.expectedRevision)
      throw new PublicError("下一条消息的扩展已变化，请重新读取");
    const retained = (v: SkillSelection) =>
      before.skills.find((s) => s.id === v.id && s.sha256 === v.sha256);
    // Removing an invalid reference must remain possible even when another saved
    // reference is stale. Every retained reference is revalidated before dispatch.
    const prepared = await skills.prepare(p.skills.filter((v) => !retained(v))),
      selected = await plugins.prepare(
        p.plugins.filter((id) => !before.plugins.some((p) => p.id === id)),
      );
    const references = p.skills.map(
      (v) => retained(v) || prepared.references.find((s) => s.id === v.id)!,
    );
    const pluginReferences = [...new Set(p.plugins)].map(
      (id) =>
        before.plugins.find((p) => p.id === id) ||
        selected.references.find((p) => p.id === id)!,
    );
    db.raw
      .prepare("INSERT OR IGNORE INTO session_inputs VALUES(?,0,?)")
      .run(p.threadId, JSON.stringify({ skills: [], plugins: [] }));
    const result = db.raw
      .prepare(
        "UPDATE session_inputs SET revision=revision+1,content=? WHERE thread_id=? AND revision=?",
      )
      .run(
        JSON.stringify({ skills: references, plugins: pluginReferences }),
        p.threadId,
        p.expectedRevision,
      );
    if (!result.changes)
      throw new PublicError("下一条消息的扩展已变化，请重新读取");
    const value = get(p.threadId);
    changed(p.threadId, value);
    return value;
  }
  function capture(p: {
    threadId?: string;
    inputRevision?: number;
    skills?: SkillSelection[];
    plugins?: string[];
  }) {
    if (!p.threadId || p.inputRevision === undefined) return {};
    const value = get(p.threadId);
    const selected = value.skills.map(({ id, sha256 }) => ({ id, sha256 }));
    if (
      value.revision !== p.inputRevision ||
      JSON.stringify(selected) !== JSON.stringify(p.skills || []) ||
      JSON.stringify(value.plugins.map((x) => x.id)) !==
        JSON.stringify(p.plugins || [])
    )
      throw new PublicError("下一条消息的扩展已变化，请重新读取后发送");
    return { inputRevision: value.revision };
  }
  /**
   * Session associations outlive a single message: keep what was dispatched so
   * the next turn inherits the same plugins/skills until the user removes them.
   */
  function remember(
    threadId: string,
    skills: SkillReference[],
    plugins: { id: string; name: string; displayName?: string }[],
  ) {
    // A turn without associations must not churn the revision.
    if (!skills.length && !plugins.length) return;
    const content = JSON.stringify({
      skills: skills.map(({ id, sha256, name, displayName, scope }) => ({
        id,
        sha256,
        name,
        displayName,
        scope,
      })),
      plugins: plugins.map(({ id, name, displayName }) => ({
        id,
        name,
        displayName: displayName || name,
      })),
    });
    db.raw
      .prepare(
        `INSERT OR IGNORE INTO session_inputs(thread_id,revision,content) VALUES(?,0,'{"skills":[],"plugins":[]}')`,
      )
      .run(threadId);
    const r = db.raw
      .prepare(
        "UPDATE session_inputs SET revision=revision+1,content=? WHERE thread_id=?",
      )
      .run(content, threadId);
    if (r.changes) changed(threadId, get(threadId));
  }
  function consume(threadId: string, revision?: number) {
    if (revision === undefined) return;
    const r = db.raw
      .prepare(
        "UPDATE session_inputs SET revision=revision+1,content=? WHERE thread_id=? AND revision=?",
      )
      .run(JSON.stringify({ skills: [], plugins: [] }), threadId, revision);
    if (r.changes) changed(threadId, get(threadId));
  }
  function references(kind: "skills" | "plugins", id: string) {
    if (kind === "plugins") {
      const rows = db.raw
        .prepare("SELECT revision,content FROM session_inputs")
        .all() as { revision: number; content: string }[];
      return rows.some((row) =>
        unifyPluginInputs(db, {
          ...JSON.parse(row.content),
          revision: row.revision,
        }).plugins.some((p) => p.id === id),
      );
    }
    return !!db.raw
      .prepare(
        "SELECT 1 FROM session_inputs, json_each(session_inputs.content,?) AS entry WHERE json_extract(entry.value,'$.id')=? LIMIT 1",
      )
      .get(`$.${kind}`, id);
  }
  return { get, update, capture, remember, consume, references };
}
