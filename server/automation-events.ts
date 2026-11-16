import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.js";
import type { credentialVault } from "./credential-vault.js";
import type { AutomationEventTrigger } from "../shared/automations.js";
import { PublicError } from "./public-error.js";
export const automationHookPath =
  /^\/api\/automation-hooks\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/;
type Route = {
  task_id: string;
  trigger_id: string;
  source: AutomationEventTrigger["source"];
  version: string;
  packet: string;
};
export type AcceptedEvent = {
  id: string;
  digest: string;
  source: AutomationEventTrigger["source"];
  type: string;
  payload: Record<string, unknown>;
};
const digest = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
const invalid = () =>
  Object.assign(new PublicError("事件入口不存在或认证失败"), {
    statusCode: 404,
  });
export function automationEvents(
  db: Store,
  vault: Pick<
    ReturnType<typeof credentialVault>,
    "openPrivate" | "sealPrivate"
  >,
  now = Date.now,
) {
  const buckets = new Map<string, { at: number; count: number }>();
  const route = (task: string, id: string) =>
    db.raw
      .prepare(
        "SELECT * FROM automation_event_routes WHERE task_id=? AND trigger_id=?",
      )
      .get(task, id) as Route | undefined;
  const context = (r: Pick<Route, "task_id" | "trigger_id" | "version">) =>
    `automation-event:${r.task_id}:${r.trigger_id}:${r.version}`;
  function replace(task: string, t: AutomationEventTrigger) {
    const version = randomUUID(),
      bytes = randomBytes(32);
    const r = { task_id: task, trigger_id: t.id, version };
    try {
      db.raw
        .prepare(
          "INSERT OR REPLACE INTO automation_event_routes VALUES(?,?,?,?,?)",
        )
        .run(
          task,
          t.id,
          t.source,
          version,
          vault.sealPrivate(bytes, context(r)),
        );
    } finally {
      bytes.fill(0);
    }
  }
  function secret(r: Route) {
    const bytes = vault.openPrivate(r.packet, context(r));
    try {
      return bytes.toString("base64");
    } finally {
      bytes.fill(0);
    }
  }
  function current(task: string, id: string) {
    const row = db.raw
      .prepare(
        "SELECT content,revision,enabled FROM automation_tasks WHERE id=? AND deleted=0",
      )
      .get(task) as
      | { content: string; revision: number; enabled: number }
      | undefined;
    const t =
      row &&
      ((JSON.parse(row.content).eventTriggers || []).find(
        (t: AutomationEventTrigger) => t.id === id,
      ) as AutomationEventTrigger | undefined);
    const r = route(task, id);
    if (!row || !t || !r || t.source !== r.source) throw invalid();
    return { row, t, r };
  }
  return {
    sync(task: string, triggers: AutomationEventTrigger[]) {
      const ids = new Set(triggers.map((t) => t.id));
      for (const r of db.raw
        .prepare(
          "SELECT trigger_id FROM automation_event_routes WHERE task_id=?",
        )
        .all(task) as { trigger_id: string }[])
        if (!ids.has(r.trigger_id))
          db.raw
            .prepare(
              "DELETE FROM automation_event_routes WHERE task_id=? AND trigger_id=?",
            )
            .run(task, r.trigger_id);
      for (const t of triggers)
        if (route(task, t.id)?.source !== t.source) replace(task, t);
    },
    settings(
      task: string,
      id: string,
      revision: number,
      rotate = false,
      expectedVersion?: string,
    ) {
      const { row, t, r: previous } = current(task, id);
      if (row.revision !== revision)
        throw new PublicError("任务已变化，请刷新后重试");
      if (rotate) {
        if (expectedVersion !== previous.version)
          throw new PublicError("密钥已变化，请关闭后重新打开连接设置");
        replace(task, t);
        db.audit("automation/event/rotate", task, "saved");
      }
      const r = route(task, id)!;
      return {
        path: `/api/automation-hooks/${task}/${id}`,
        source: t.source,
        secret: secret(r),
        version: r.version,
      };
    },
    receive(
      task: string,
      id: string,
      raw: Buffer,
      headers: Record<string, string | string[] | undefined>,
    ) {
      const { row, t, r } = current(task, id);
      const time = now();
      for (const [key, b] of buckets)
        if (time - b.at > 60000) buckets.delete(key);
      const key = task + ":" + id,
        bucket = buckets.get(key) || { at: time, count: 0 };
      buckets.set(key, bucket);
      if (++bucket.count > 60)
        throw Object.assign(new PublicError("请求过于频繁，请稍后重试"), {
          statusCode: 429,
        });
      if (!Buffer.isBuffer(raw) || raw.length > 64000)
        throw Object.assign(new PublicError("事件内容超过限制"), {
          statusCode: 413,
        });
      const h = (key: string) =>
        typeof headers[key] === "string" ? (headers[key] as string) : "";
      const token = secret(r),
        mac = (
          input: string | Buffer,
          encoding: "hex" | "base64" = "hex",
          standard = false,
        ) =>
          createHmac("sha256", standard ? Buffer.from(token, "base64") : token)
            .update(input)
            .digest(encoding);
      let eventId = "";
      if (t.source === "github") {
        if (!equal(h("x-hub-signature-256"), "sha256=" + mac(raw)))
          throw invalid();
        eventId = h("x-github-delivery");
      } else if (t.source === "openclaw") {
        if (
          !equal(h("authorization"), "Bearer " + token) &&
          !equal(h("x-openclaw-token"), token)
        )
          throw invalid();
        eventId = h("idempotency-key");
      } else {
        const stamp = h(
          t.source === "hermes" ? "x-webhook-timestamp" : "webhook-timestamp",
        );
        if (
          !/^\d{10}$/.test(stamp) ||
          Math.abs(time - Number(stamp) * 1000) > 300000
        )
          throw invalid();
        if (t.source === "hermes") {
          if (
            !equal(
              h("x-webhook-signature-v2"),
              mac(Buffer.concat([Buffer.from(stamp + "."), raw])),
            )
          )
            throw invalid();
          eventId = digest(Buffer.concat([Buffer.from(stamp + "."), raw]));
        } else {
          eventId = h("webhook-id");
          const expected =
            "v1," +
            mac(
              Buffer.concat([Buffer.from(eventId + "." + stamp + "."), raw]),
              "base64",
              true,
            );
          if (
            !h("webhook-signature")
              .split(" ")
              .slice(0, 8)
              .some((v) => equal(v, expected))
          )
            throw invalid();
        }
      }
      if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(eventId))
        throw new PublicError("缺少有效的事件标识");
      if (!row.enabled)
        throw Object.assign(new PublicError("自动任务已暂停"), {
          statusCode: 409,
        });
      let body: Record<string, any>;
      try {
        body = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(raw.toString("utf8")));
      } catch {
        throw new PublicError("事件内容必须是 JSON 对象");
      }
      if (t.source === "openclaw") {
        if (typeof body.message !== "string" || !body.message.trim())
          throw new PublicError("OpenClaw 事件需要 message");
        if (
          Object.keys(body).some(
            (k) => !["message", "name", "event_type", "deliver"].includes(k),
          ) ||
          body.deliver === true
        )
          throw new PublicError(
            "此入口由任务配置模型、会话和权限；仅支持 message、name、event_type 及 deliver:false",
          );
      }
      const type = String(
        t.source === "github"
          ? h("x-github-event")
          : body.event_type || body.type || "event",
      ).slice(0, 100);
      if (t.source === "github" && type === "ping")
        return { ignored: true as const, reason: "ping" };
      if (
        (t.events.length && !t.events.includes(type)) ||
        (t.repository && body.repository?.full_name !== t.repository) ||
        (t.actions.length && !t.actions.includes(body.action))
      )
        return { ignored: true as const, reason: "filter" };
      const payload =
        t.source === "github"
          ? {
              event: type,
              action: body.action,
              repository: body.repository?.full_name,
              ref: body.ref,
              issue: body.issue && {
                number: body.issue.number,
                title: body.issue.title,
                body: body.issue.body,
                url: body.issue.html_url,
              },
              pull_request: body.pull_request && {
                number: body.pull_request.number,
                title: body.pull_request.title,
                body: body.pull_request.body,
                url: body.pull_request.html_url,
              },
              head_commit: body.head_commit && {
                id: body.head_commit.id,
                message: body.head_commit.message,
              },
            }
          : body;
      if (JSON.stringify(payload).length > 20000)
        throw new PublicError("事件正文超过 20000 字符，请缩小投递内容");
      return {
        ignored: false as const,
        revision: row.revision,
        event: {
          id: eventId,
          digest: digest(raw),
          source: t.source,
          type,
          payload,
        } satisfies AcceptedEvent,
      };
    },
  };
}
