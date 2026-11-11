import type { Store } from "./db.js";
import type { PluginReference, SessionInputs } from "../shared/types.js";

/** Resolve persisted pre-unification references without rewriting past messages. */
export function skillPlugin(db: Store, id: string) {
  const row = db.raw
    .prepare(
      "SELECT identity FROM extension_assets WHERE id=? OR EXISTS(SELECT 1 FROM json_each(aliases) WHERE value=?)",
    )
    .get(id, id) as { identity: string } | undefined;
  return row?.identity.match(/^plugin:([^:]+):/)?.[1];
}
export function ownedPluginReference(id: string): PluginReference {
  const name = id.split("@")[0];
  return { id, name, displayName: name };
}
export function unifyPluginInputs(
  db: Store,
  value: SessionInputs,
): SessionInputs {
  const plugins = new Map(value.plugins.map((p) => [p.id, p]));
  const skills = value.skills.filter((s) => {
    const owner = skillPlugin(db, s.id);
    if (!owner) return true;
    if (!plugins.has(owner)) plugins.set(owner, ownedPluginReference(owner));
    return false;
  });
  return { ...value, skills, plugins: [...plugins.values()] };
}
