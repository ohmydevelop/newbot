import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  automationSchema,
  type Automation,
  type AutomationInput,
  type AutomationRun,
} from "../shared/automations.js";
import { nextScheduled, latestScheduled } from "./automation-schedule.js";
import type { Store } from "./db.js";
import { PublicError, publicErrorMessage } from "./public-error.js";
type Row = {
  id: string;
  revision: number;
  content: string;
  enabled: number;
  next_run: number | null;
  created: number;
  updated: number;
  deleted: number;
};
type RunRow = {
  id: string;
  task_id: string;
  task_revision: number;
  scheduled_at: number;
  state: string;
  request_id: string;
  thread_id: string | null;
  turn_id: string | null;
  snapshot: string;
  started: number | null;
  completed: number | null;
  error: string | null;
  is_read: number;
};
type Dependencies = {
  mail?: Pick<
    ReturnType<typeof import("./automation-mail.js").automationMail>,
    "status" | "tick" | "close"
  >;
  now?: () => number;
  ready: () => boolean;
  validate: (input: AutomationInput) => Promise<void>;
  submit: (
    input: Record<string, unknown>,
  ) => Promise<{ statusCode: number; body: any }>;
  probe: (
    requestId: string,
    threadId: string | null,
    turnId: string | null,
  ) => Promise<{
    state: string;
    threadId?: string;
    turnId?: string;
    error?: string;
  }>;
  cancel: (
    requestId: string,
    threadId: string | null,
    turnId: string | null,
  ) => Promise<void>;
};
const active = "'queued','dispatching','running','waiting'";
export function automations(db: Store, deps: Dependencies) {
  const now = deps.now || Date.now;
  let ticking: Promise<void> | null = null,
    timer: ReturnType<typeof setInterval> | undefined,
    closed = false;
  const row = (id: string) =>
    db.raw
      .prepare("SELECT * FROM automation_tasks WHERE id=? AND deleted=0")
      .get(id) as Row | undefined;
  function requireRow(id: string) {
    const r = row(id);
    if (!r) throw new PublicError("自动任务不存在");
    return r;
  }
  function history(id: string, cursor?: string) {
    const before = cursor
      ? (db.raw
          .prepare(
            "SELECT scheduled_at,id FROM automation_runs WHERE id=? AND task_id=?",
          )
          .get(cursor, id) as { scheduled_at: number; id: string } | undefined)
      : undefined;
    if (cursor && !before) throw new PublicError("运行记录已变化，请刷新");
    return db.raw
      .prepare(
        `SELECT * FROM automation_runs WHERE task_id=? ${before ? "AND (scheduled_at < ? OR (scheduled_at = ? AND id < ?))" : ""} ORDER BY scheduled_at DESC,id DESC LIMIT 51`,
      )
      .all(
        id,
        ...(before
          ? [before.scheduled_at, before.scheduled_at, before.id]
          : []),
      ) as RunRow[];
  }
  const runView = (r: RunRow): AutomationRun => ({
    id: r.id,
    taskId: r.task_id,
    taskRevision: r.task_revision,
    scheduledAt: r.scheduled_at,
    state: r.state,
    requestId: r.request_id,
    threadId: r.thread_id,
    turnId: r.turn_id,
    started: r.started,
    completed: r.completed,
    error: r.error,
    read: !!r.is_read,
    name: JSON.parse(r.snapshot).name,
    notification: JSON.parse(r.snapshot).notification,
    delivery: deps.mail?.status(r.id),
  });
  function view(r: Row): Automation {
    const counts = db.raw
      .prepare(
        `SELECT SUM(CASE WHEN state IN (${active}) THEN 1 ELSE 0 END) AS active_count,SUM(CASE WHEN is_read=0 AND completed IS NOT NULL AND json_extract(snapshot,'$.notification') IN ('app','both') THEN 1 ELSE 0 END) AS unread FROM automation_runs WHERE task_id=?`,
      )
      .get(r.id) as { active_count: number | null; unread: number | null };
    return {
      ...JSON.parse(r.content),
      id: r.id,
      revision: r.revision,
      enabled: !!r.enabled,
      nextRun: r.next_run,
      created: r.created,
      updated: r.updated,
      activeRuns: counts.active_count || 0,
      unread: counts.unread || 0,
    };
  }

  function list() {
    return (
      db.raw
        .prepare(
          "SELECT * FROM automation_tasks WHERE deleted=0 ORDER BY created DESC",
        )
        .all() as Row[]
    ).map(view);
  }
  function transaction<T>(fn: () => T): T {
    db.raw.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      db.raw.exec("COMMIT");
      return v;
    } catch (e) {
      db.raw.exec("ROLLBACK");
      throw e;
    }
  }
  async function save(p: unknown) {
    const { id, expectedRevision, content } = z
      .object({
        id: z.string().uuid(),
        expectedRevision: z.number().int().nonnegative(),
        content: automationSchema,
      })
      .parse(p);
    for (const t of content.triggers) nextScheduled([t], now());
    await deps.validate(content);
    return transaction(() => {
      const before = row(id);
      if (!before && expectedRevision !== 0)
        throw new PublicError("任务已删除，请刷新");
      if (
        before &&
        expectedRevision === 0 &&
        before.content === JSON.stringify(content)
      )
        return view(before);
      if ((before?.revision || 0) !== expectedRevision)
        throw new PublicError("任务已变化，请刷新后重试");
      if (!before && list().length >= 200)
        throw new PublicError("自动任务数量已达上限");
      const next = nextScheduled(content.triggers, now());
      if (!before && !next)
        throw new PublicError("触发时间已过去，请选择未来时间");
      if (before)
        db.raw
          .prepare(
            "UPDATE automation_tasks SET revision=revision+1,content=?,next_run=?,updated=? WHERE id=?",
          )
          .run(
            JSON.stringify(content),
            before.enabled ? next : null,
            now(),
            id,
          );
      else
        db.raw
          .prepare("INSERT INTO automation_tasks VALUES(?,1,?,1,?,?,?,0)")
          .run(id, JSON.stringify(content), next, now(), now());
      db.raw
        .prepare(
          "UPDATE automation_runs SET state='cancelled',completed=?,error='任务已编辑，旧排队任务已取消' WHERE task_id=? AND state='queued'",
        )
        .run(now(), id);
      db.raw
        .prepare("DELETE FROM automation_attachment_refs WHERE task_id=?")
        .run(id);
      for (const file of content.attachments)
        db.raw
          .prepare("INSERT INTO automation_attachment_refs VALUES(?,?)")
          .run(id, file);
      db.audit("automation/save", id, "saved");
      return view(requireRow(id));
    });
  }
  function control(
    id: string,
    revision: number,
    action: "pause" | "resume" | "delete",
  ) {
    return transaction(() => {
      const r = requireRow(id);
      if (r.revision !== revision)
        throw new PublicError("任务已变化，请刷新后重试");
      const next =
        action === "resume"
          ? nextScheduled(JSON.parse(r.content).triggers, now())
          : null;
      if (action === "resume" && !next)
        throw new PublicError("计划没有未来的执行时间，请先编辑");
      db.raw
        .prepare(
          "UPDATE automation_tasks SET revision=revision+1,enabled=?,next_run=?,deleted=?,updated=? WHERE id=?",
        )
        .run(
          action === "resume" ? 1 : 0,
          next,
          action === "delete" ? 1 : 0,
          now(),
          id,
        );
      if (action !== "resume")
        db.raw
          .prepare(
            "UPDATE automation_runs SET state='cancelled',completed=?,error='任务已暂停或删除' WHERE task_id=? AND state='queued'",
          )
          .run(now(), id);
      if (action === "delete")
        db.raw
          .prepare("DELETE FROM automation_attachment_refs WHERE task_id=?")
          .run(id);
      db.audit("automation/" + action, id, "saved");
      return action === "delete" ? null : view(requireRow(id));
    });
  }
  function enqueue(
    r: Row,
    key: string,
    at: number,
    requestId: string = randomUUID(),
  ) {
    const prior = db.raw
      .prepare(
        "SELECT * FROM automation_runs WHERE task_id=? AND trigger_key=?",
      )
      .get(r.id, key) as RunRow | undefined;
    if (prior) return prior;
    if (
      db.raw
        .prepare(
          `SELECT 1 FROM automation_runs WHERE task_id=? AND state IN (${active})`,
        )
        .get(r.id)
    )
      throw new PublicError("此任务正在运行或等待处理");
    const id = randomUUID();
    db.raw
      .prepare(
        "INSERT INTO automation_runs(id,task_id,task_revision,trigger_key,scheduled_at,state,request_id,snapshot) VALUES(?,?,?,?,?,'queued',?,?)",
      )
      .run(id, r.id, r.revision, key, at, requestId, r.content);
    return db.raw
      .prepare("SELECT * FROM automation_runs WHERE id=?")
      .get(id) as RunRow;
  }
  function runNow(id: string, revision: number, requestId: string) {
    const r = requireRow(id);
    if (r.revision !== revision)
      throw new PublicError("任务已变化，请刷新后重试");
    return runView(enqueue(r, "manual:" + requestId, now(), requestId));
  }
  function updateRun(
    r: RunRow,
    state: string,
    detail: { threadId?: string; turnId?: string; error?: string } = {},
  ) {
    const terminal = !["queued", "dispatching", "running", "waiting"].includes(
      state,
    );
    db.raw
      .prepare(
        "UPDATE automation_runs SET state=?,thread_id=COALESCE(?,thread_id),turn_id=COALESCE(?,turn_id),error=?,completed=? WHERE id=?",
      )
      .run(
        state,
        detail.threadId || null,
        detail.turnId || null,
        detail.error || null,
        terminal ? now() : null,
        r.id,
      );
  }
  async function tickBody() {
    if (closed) return;
    void deps.mail
      ?.tick()
      .catch(() => db.audit("automation/mail", "outbox", "failed"));
    const inFlight = db.raw
      .prepare(
        `SELECT * FROM automation_runs WHERE state IN ('dispatching','running','waiting')`,
      )
      .all() as RunRow[];
    for (const r of inFlight) {
      if (!deps.ready()) continue;
      try {
        const p = await deps.probe(r.request_id, r.thread_id, r.turn_id);
        if (p.state !== "dispatching") updateRun(r, p.state, p);
      } catch {
        /* Keep the last confirmed state while the runtime reconnects. */
      }
    }
    if (!deps.ready() || closed) return;
    const due = db.raw
      .prepare(
        "SELECT * FROM automation_tasks WHERE enabled=1 AND deleted=0 AND next_run<=? ORDER BY next_run LIMIT 50",
      )
      .all(now()) as Row[];
    for (const r of due) {
      if (
        db.raw
          .prepare(
            `SELECT 1 FROM automation_runs WHERE task_id=? AND state IN (${active})`,
          )
          .get(r.id)
      )
        continue;
      transaction(() => {
        enqueue(
          r,
          `schedule:${r.revision}:${r.next_run}`,
          latestScheduled(JSON.parse(r.content).triggers, now()) ?? r.next_run!,
        );
        db.raw
          .prepare(
            "UPDATE automation_tasks SET next_run=? WHERE id=? AND revision=?",
          )
          .run(
            nextScheduled(JSON.parse(r.content).triggers, now()),
            r.id,
            r.revision,
          );
      });
    }
    const queued = db.raw
      .prepare(
        "SELECT * FROM automation_runs WHERE state='queued' ORDER BY scheduled_at LIMIT 10",
      )
      .all() as RunRow[];
    for (const r of queued) {
      if (closed || !deps.ready()) break;
      const task = row(r.task_id);
      if (!task || task.revision !== r.task_revision) {
        updateRun(r, "cancelled", { error: "计划已变化" });
        continue;
      }
      db.raw
        .prepare(
          "UPDATE automation_runs SET state='dispatching',started=? WHERE id=? AND state='queued'",
        )
        .run(now(), r.id);
      try {
        const input: AutomationInput = JSON.parse(r.snapshot);
        const { statusCode, body } = await deps.submit({
          text: input.prompt,
          provider: input.provider || undefined,
          model: input.model || undefined,
          effort: input.effort || undefined,
          mode: input.mode,
          approval: input.approval,
          attachments: input.attachments,
          plugins: input.plugins,
          skills: input.skills,
          expertId: input.expertId,
          requestId: r.request_id,
        });
        if ([429, 503].includes(statusCode)) {
          updateRun(r, "queued");
          break;
        }
        if (body.state === "awaiting_credentials") {
          await deps.cancel(r.request_id, body.threadId || null, null);
          updateRun(r, "blocked", {
            error: "需要私密授权。请先完成连接器或模型配置，再重新运行。",
          });
        } else if (statusCode >= 400)
          updateRun(r, body.state === "unknown" ? "unknown" : "failed", {
            error: body.error || "任务启动失败",
            threadId: body.threadId,
            turnId: body.turn?.id,
          });
        else
          updateRun(r, "running", {
            threadId: body.threadId,
            turnId: body.turn?.id,
          });
      } catch (e) {
        const p = await deps
          .probe(r.request_id, null, null)
          .catch(() => ({ state: "unknown" }));
        updateRun(
          r,
          p.state === "running"
            ? "running"
            : p.state === "unknown"
              ? "unknown"
              : "failed",
          { ...p, error: publicErrorMessage(e) },
        );
      }
    }
  }
  function tick() {
    if (!ticking)
      ticking = tickBody().finally(() => {
        ticking = null;
      });
    return ticking;
  }
  async function stop(id: string) {
    const r = db.raw
      .prepare("SELECT * FROM automation_runs WHERE id=?")
      .get(id) as RunRow | undefined;
    if (!r) throw new PublicError("运行记录不存在");
    if (r.state === "queued") {
      updateRun(r, "cancelled");
      return;
    }
    if (r.state === "dispatching")
      throw new PublicError("任务正在启动，请稍后停止");
    if (["running", "waiting"].includes(r.state)) {
      await deps.cancel(r.request_id, r.thread_id, r.turn_id);
      updateRun(r, "cancelled");
    }
  }
  return {
    save,
    list,
    control,
    runNow,
    tick,
    stop,
    result: (id: string) => {
      const r = db.raw
        .prepare("SELECT * FROM automation_runs WHERE id=?")
        .get(id) as RunRow | undefined;
      if (!r) throw new PublicError("运行记录不存在");
      return runView(r);
    },
    read: (id: string, cursor?: string) => {
      const task = view(requireRow(id)),
        all = history(id, cursor);
      return {
        task,
        runs: all.slice(0, 50).map(runView),
        nextCursor: all.length > 50 ? all[49].id : null,
      };
    },
    markRead: (id: string) => {
      db.raw.prepare("UPDATE automation_runs SET is_read=1 WHERE id=?").run(id);
    },
    notices: () =>
      (
        db.raw
          .prepare(
            "SELECT * FROM automation_runs WHERE is_read=0 AND completed IS NOT NULL AND json_extract(snapshot,'$.notification') IN ('app','both') ORDER BY scheduled_at DESC,id DESC LIMIT 100",
          )
          .all() as RunRow[]
      ).map(runView),
    start: () => {
      if (!timer) {
        timer = setInterval(
          () =>
            void tick().catch(() =>
              db.audit("automation/tick", "scheduler", "failed"),
            ),
          2000,
        );
        timer.unref();
      }
    },
    close: async () => {
      closed = true;
      if (timer) clearInterval(timer);
      await ticking;
      await deps.mail?.close();
    },
  };
}
