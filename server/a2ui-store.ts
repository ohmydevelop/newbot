import { PublicError } from "./public-error.js";
import { z } from "zod";
import type { Store } from "./db.js";
import type { A2uiView } from "../shared/a2ui-chat.js";
import { encodeA2ui, decodeA2ui } from "../shared/a2ui-policy.js";

type Row = {
  id: string;
  thread_id: string;
  turn_id: string;
  item_id: string;
  surface_id: string;
  revision: number;
  state: A2uiView["state"];
  reason: A2uiView["reason"] | null;
  expires: number | null;
  format: number;
  snapshot: string;
  bytes: number;
  updated: number;
};
type DraftRow = {
  view_id: string;
  view_revision: number;
  version: number;
  content: string;
  bytes: number;
  updated: number;
  expires: number;
};
export type UiReceipt = {
  requestId: string;
  viewId: string;
  fingerprint: string;
  state: "unknown" | "accepted";
};
export class A2uiStorageError extends PublicError {
  readonly statusCode = 507;
  constructor() {
    super("表单状态未能保存，请检查存储空间后重试");
  }
}
const state = z.enum([
  "display",
  "waiting",
  "submitted",
  "cancelled",
  "unavailable",
]);
const reason = z.enum([
  "expired",
  "runtime_restarted",
  "runtime_stopped",
  "interrupted",
  "request_resolved",
  "incomplete",
  "invalid",
  "submission_unconfirmed",
]);
const identity = z.object({
  id: z.string().uuid(),
  thread_id: z.string().min(1).max(200),
  turn_id: z.string().min(1).max(200),
  item_id: z.string().min(1).max(200),
  surface_id: z.string().min(1).max(64),
  revision: z.number().int().positive(),
  state,
  reason: reason.nullable(),
  expires: z.number().int().nullable(),
});
export function a2uiStore(
  db: Store,
  limits = { views: 512, bytes: 32 * 1024 * 1024 },
) {
  const sql = db.raw;
  function transaction<T>(action: () => T): T {
    sql.exec("BEGIN IMMEDIATE");
    try {
      const value = action();
      sql.exec("COMMIT");
      return value;
    } catch (error) {
      sql.exec("ROLLBACK");
      throw error;
    }
  }
  // A persisted UI is never proof that its old native RPC is still alive.
  transaction(() => {
    sql
      .prepare(
        "UPDATE a2ui_views SET state='unavailable',reason='runtime_restarted',revision=revision+1 WHERE state='waiting'",
      )
      .run();
    sql
      .prepare(
        "UPDATE a2ui_drafts SET view_revision=(SELECT revision FROM a2ui_views WHERE id=view_id) WHERE view_id IN (SELECT id FROM a2ui_views WHERE reason='runtime_restarted')",
      )
      .run();
    sql.prepare("DELETE FROM a2ui_drafts WHERE expires < ?").run(Date.now());
  });
  function row(id: string) {
    return sql.prepare("SELECT * FROM a2ui_views WHERE id=?").get(id) as
      | Row
      | undefined;
  }
  function budget(delta: number, fresh = false) {
    sql.prepare("DELETE FROM a2ui_drafts WHERE expires < ?").run(Date.now());
    const usage = sql
      .prepare(
        "SELECT (SELECT COALESCE(SUM(bytes),0) FROM a2ui_views)+(SELECT COALESCE(SUM(bytes),0) FROM a2ui_drafts) AS bytes,(SELECT COUNT(*) FROM a2ui_views) AS views",
      )
      .get() as { bytes: number; views: number };
    if (
      usage.bytes + delta > limits.bytes ||
      (fresh && usage.views >= limits.views)
    )
      throw new A2uiStorageError();
  }
  function receipt(input: UiReceipt) {
    const old = getReceipt(input.requestId);
    if (
      old &&
      (old.viewId !== input.viewId || old.fingerprint !== input.fingerprint)
    )
      throw new A2uiStorageError();
    sql
      .prepare(
        "INSERT INTO a2ui_receipts(request_id,view_id,fingerprint,state,created) VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET state=excluded.state",
      )
      .run(
        input.requestId,
        input.viewId,
        input.fingerprint,
        input.state,
        Date.now(),
      );
    sql.exec(
      "DELETE FROM a2ui_receipts WHERE request_id IN (SELECT request_id FROM a2ui_receipts ORDER BY created DESC LIMIT -1 OFFSET 2048)",
    );
  }
  function getReceipt(id: string): UiReceipt | undefined {
    const r = sql
      .prepare(
        "SELECT request_id,view_id,fingerprint,state FROM a2ui_receipts WHERE request_id=?",
      )
      .get(id) as
      | {
          request_id: string;
          view_id: string;
          fingerprint: string;
          state: UiReceipt["state"];
        }
      | undefined;
    return r
      ? {
          requestId: r.request_id,
          viewId: r.view_id,
          fingerprint: r.fingerprint,
          state: r.state,
        }
      : undefined;
  }
  function save(
    view: A2uiView,
    calls: Set<string>,
    draft: "retain" | "clear" = "retain",
    submission?: UiReceipt,
  ) {
    const snapshot = encodeA2ui(view.messages);
    const ids = [...calls];
    if (ids.length > 128 || ids.some((id) => !id.length || id.length > 200))
      throw new A2uiStorageError();
    const bytes =
      Buffer.byteLength(snapshot) +
      ids.reduce((total, id) => total + Buffer.byteLength(id) + 64, 0);
    transaction(() => {
      const old = row(view.id);
      if (
        old &&
        (old.thread_id !== view.threadId ||
          old.turn_id !== view.turnId ||
          old.item_id !== view.itemId ||
          old.surface_id !== view.surfaceId)
      )
        throw new A2uiStorageError();
      budget(bytes - (old?.bytes || 0), !old);
      sql
        .prepare(
          `INSERT INTO a2ui_views(id,thread_id,turn_id,item_id,surface_id,revision,state,reason,expires,format,snapshot,bytes,updated) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state,reason=excluded.reason,expires=excluded.expires,snapshot=excluded.snapshot,bytes=excluded.bytes,updated=excluded.updated`,
        )
        .run(
          view.id,
          view.threadId,
          view.turnId,
          view.itemId,
          view.surfaceId,
          view.revision,
          view.state,
          view.reason || null,
          view.expiresAt || null,
          snapshot,
          bytes,
          Date.now(),
        );
      const insert = sql.prepare(
        "INSERT OR IGNORE INTO a2ui_calls(thread_id,turn_id,call_id,view_id) VALUES(?,?,?,?)",
      );
      for (const id of ids) insert.run(view.threadId, view.turnId, id, view.id);
      sql
        .prepare("UPDATE a2ui_drafts SET view_revision=? WHERE view_id=?")
        .run(view.revision, view.id);
      if (draft === "clear")
        sql
          .prepare(
            "UPDATE a2ui_drafts SET content='null',bytes=4,version=version+1,updated=? WHERE view_id=?",
          )
          .run(Date.now(), view.id);
      if (submission) receipt(submission);
    });
  }
  function load(
    id: string,
  ): { view: A2uiView; calls: Set<string> } | undefined {
    const r = row(id);
    if (!r || !db.owns(r.thread_id) || !identity.safeParse(r).success) return;
    let messages: A2uiView["messages"] = [];
    let invalid = r.format !== 1 || r.snapshot.length > 65_536;
    try {
      if (r.snapshot !== "[]") messages = decodeA2ui(r.snapshot);
    } catch {
      invalid = true;
    }
    const calls = new Set(
      (
        sql
          .prepare("SELECT call_id FROM a2ui_calls WHERE view_id=? LIMIT 129")
          .all(id) as { call_id: string }[]
      ).map((c) => c.call_id),
    );
    if (
      calls.size > 128 ||
      [...calls].some((id) => !id.length || id.length > 200)
    )
      invalid = true;
    const view: A2uiView = {
      id: r.id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      itemId: r.item_id,
      surfaceId: r.surface_id,
      revision: r.revision,
      state: invalid || r.state === "waiting" ? "unavailable" : r.state,
      messages: invalid ? [] : messages,
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.expires ? { expiresAt: r.expires } : {}),
    };
    if (invalid) view.reason = "invalid";
    return { view, calls };
  }
  function draft(id: string, revision: number) {
    const r = sql
      .prepare("SELECT * FROM a2ui_drafts WHERE view_id=?")
      .get(id) as DraftRow | undefined;
    if (!r || r.view_revision !== revision) return { version: 0 };
    if (r.expires < Date.now()) {
      sql
        .prepare("DELETE FROM a2ui_drafts WHERE view_id=? AND expires < ?")
        .run(id, Date.now());
      return { version: 0 };
    }
    try {
      if (r.content === "null") return { version: r.version };
      if (r.content.length > 65_536) return { version: r.version };
      const values = JSON.parse(r.content);
      encodeA2ui(values);
      z.record(z.string(), z.union([z.string(), z.array(z.string())])).parse(
        values,
      );
      return {
        version: r.version,
        values: values as Record<string, string | string[]>,
        updatedAt: r.updated,
      };
    } catch {
      return { version: r.version };
    }
  }
  function saveDraft(
    id: string,
    revision: number,
    expected: number,
    values: Record<string, string | string[]> | null,
  ) {
    const content = values ? encodeA2ui(values) : "null",
      bytes = Buffer.byteLength(content);
    return transaction(() => {
      const view = row(id);
      if (!view || view.revision !== revision || view.state !== "waiting")
        throw Object.assign(new PublicError("表单已变化，请重新读取会话"), {
          statusCode: 409,
        });
      const old = sql
        .prepare("SELECT * FROM a2ui_drafts WHERE view_id=?")
        .get(id) as DraftRow | undefined;
      const version =
        old && old.view_revision === revision && old.expires >= Date.now()
          ? old.version
          : 0;
      if (version !== expected)
        throw Object.assign(
          new PublicError("草稿已在其他页面更新，请重新载入后再编辑"),
          { statusCode: 409 },
        );
      budget(bytes - (old?.bytes || 0));
      const updatedAt = Date.now();
      sql
        .prepare(
          "INSERT INTO a2ui_drafts(view_id,view_revision,version,content,bytes,updated,expires) VALUES(?,?,?,?,?,?,?) ON CONFLICT(view_id) DO UPDATE SET view_revision=excluded.view_revision,version=excluded.version,content=excluded.content,bytes=excluded.bytes,updated=excluded.updated,expires=excluded.expires",
        )
        .run(
          id,
          revision,
          version + 1,
          content,
          bytes,
          updatedAt,
          updatedAt + 86_400_000,
        );
      return { version: version + 1, updatedAt };
    });
  }
  const idBySurface = (threadId: string, turnId: string, surfaceId: string) =>
    (
      sql
        .prepare(
          "SELECT id FROM a2ui_views WHERE thread_id=? AND turn_id=? AND surface_id=?",
        )
        .get(threadId, turnId, surfaceId) as { id: string } | undefined
    )?.id;
  const idByCall = (threadId: string, turnId: string, callId: string) =>
    (
      sql
        .prepare(
          "SELECT view_id FROM a2ui_calls WHERE thread_id=? AND turn_id=? AND call_id=?",
        )
        .get(threadId, turnId, callId) as { view_id: string } | undefined
    )?.view_id;
  const turnIds = (threadId: string, turnId: string) =>
    (
      sql
        .prepare(
          "SELECT id FROM a2ui_views WHERE thread_id=? AND turn_id=? ORDER BY updated LIMIT 128",
        )
        .all(threadId, turnId) as { id: string }[]
    ).map((row) => row.id);
  return {
    save,
    load,
    draft,
    saveDraft,
    idBySurface,
    idByCall,
    turnIds,
    getReceipt,
  };
}
