import { realpathSync } from "node:fs";
import {
  LocalWorkspaceRoots,
  checkedWorkspaceRoot,
} from "./runner/workspace-roots.js";
import { join, resolve } from "node:path";
import type { Store } from "./db.js";
import { PublicError } from "./public-error.js";
import { ExtensionResources } from "./extension-resources.js";
export function workspaces(
  directory: string,
  legacyRoot: string,
  db: Store,
  workspaceParent = resolve(directory, "workspaces"),
) {
  const physical = new LocalWorkspaceRoots(
    db.get("runner:workspace-root") || workspaceParent,
  );
  const parent = physical.parent;
  const legacy = realpathSync(db.get("runner:legacy-workspace") || legacyRoot);
  const safe = checkedWorkspaceRoot;
  // Existing conversations keep their original shared directory; files are never silently moved.
  db.raw
    .prepare(
      `INSERT INTO thread_workspaces(thread_id,workspace_id,root,legacy,revision,snapshot) SELECT id,NULL,?,1,'','{}' FROM threads WHERE id NOT IN (SELECT thread_id FROM thread_workspaces)`,
    )
    .run(legacy);
  const allocate = () => physical.allocate();
  function bind(threadId: string, workspace: { id: string; root: string }) {
    db.raw
      .prepare("INSERT INTO thread_workspaces VALUES(?,?,?,0,?,?)")
      .run(threadId, workspace.id, workspace.root, "", "{}");
  }
  function row(threadId: string) {
    if (!db.owns(threadId)) throw new PublicError("会话不存在");
    let r = db.raw
      .prepare("SELECT * FROM thread_workspaces WHERE thread_id=?")
      .get(threadId) as
      | {
          root: string;
          workspace_id: string | null;
          legacy: number;
          revision: string;
          snapshot: string;
        }
      | undefined;
    if (!r) {
      db.raw
        .prepare("INSERT INTO thread_workspaces VALUES(?,NULL,?,1,'','{}')")
        .run(threadId, legacy);
      r = db.raw
        .prepare("SELECT * FROM thread_workspaces WHERE thread_id=?")
        .get(threadId) as any;
    }
    return r!;
  }
  function root(threadId: string) {
    const r = row(threadId);
    if (
      !r.legacy &&
      (r.root !== join(parent, r.workspace_id || "") || !r.workspace_id)
    )
      throw new PublicError("会话目录绑定无效");
    return safe(r.root);
  }
  function saved(threadId: string) {
    const r = row(threadId);
    return { revision: r.revision, snapshot: JSON.parse(r.snapshot) };
  }
  function confirm(threadId: string, revision: string, snapshot: object) {
    new ExtensionResources(db).pin(`thread:${threadId}`, snapshot);
    db.raw
      .prepare(
        "UPDATE thread_workspaces SET revision=?,snapshot=? WHERE thread_id=?",
      )
      .run(revision, JSON.stringify(snapshot), threadId);
  }
  return { allocate, bind, root, saved, confirm, legacyRoot: legacy };
}
export type Workspaces = ReturnType<typeof workspaces>;
