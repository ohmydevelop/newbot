import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Store } from "../db.js";
import type { automations } from "../automations.js";
import type { credentialVault } from "../credential-vault.js";
import { PublicError } from "../public-error.js";
import { cloudEvent } from "../../packages/event-bridge/protocol.js";
import { hash } from "./contracts.js";

export const incomingEventPath = "/api/events/incoming/:taskId/:triggerId";
export const pluginEventPath = "/api/events/plugins/:key";
export function isEventDelivery(method: string, route: string | undefined) {
  return (
    method === "POST" &&
    [incomingEventPath, pluginEventPath].includes(route || "")
  );
}
const target = z.strictObject({
  taskId: z.string().uuid(),
  triggerId: z.string().uuid(),
  revision: z.number().int().positive(),
  rotate: z.boolean().default(false),
});
type Credential = { revision: number; packet: string };
export function incomingEvents(
  app: FastifyInstance,
  db: Store,
  vault: Pick<
    ReturnType<typeof credentialVault>,
    "sealPrivate" | "openPrivate"
  >,
  tasks: ReturnType<typeof automations>,
  origin: string,
) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS automation_incoming_credentials (
    task_id TEXT NOT NULL,trigger_id TEXT NOT NULL,revision INTEGER NOT NULL,packet TEXT NOT NULL,
    PRIMARY KEY(task_id,trigger_id));
    DELETE FROM automation_incoming_credentials WHERE task_id NOT IN
    (SELECT id FROM automation_tasks WHERE deleted=0);`);
  const locate = (taskId: string, triggerId: string) => {
    const task = tasks.list().find((t) => t.id === taskId);
    const trigger = task?.eventTriggers.find(
      (t) => t.id === triggerId && t.source === "incoming",
    );
    if (!task || !trigger)
      throw Object.assign(new PublicError("接收入口不存在"), {
        statusCode: 404,
      });
    return { task, trigger };
  };
  const binding = (taskId: string, triggerId: string, revision: number) =>
    `incoming:${taskId}:${triggerId}:${revision}`;
  const read = (taskId: string, triggerId: string) =>
    db.raw
      .prepare(
        "SELECT revision,packet FROM automation_incoming_credentials WHERE task_id=? AND trigger_id=?",
      )
      .get(taskId, triggerId) as Credential | undefined;
  app.post(
    "/api/automations/incoming-connection",
    { bodyLimit: 1024 },
    (req) => {
      const p = target.parse(req.body),
        { task } = locate(p.taskId, p.triggerId);
      if (task.revision !== p.revision)
        throw Object.assign(new PublicError("任务已变化，请刷新后重试"), {
          statusCode: 409,
        });
      let row = read(p.taskId, p.triggerId);
      if (!row || row.revision !== task.revision || p.rotate) {
        const bytes = Buffer.from(randomBytes(32).toString("base64url"));
        try {
          row = {
            revision: task.revision,
            packet: vault.sealPrivate(
              bytes,
              binding(task.id, p.triggerId, task.revision),
            ),
          };
          db.raw
            .prepare(
              "INSERT INTO automation_incoming_credentials VALUES(?,?,?,?) ON CONFLICT(task_id,trigger_id) DO UPDATE SET revision=excluded.revision,packet=excluded.packet",
            )
            .run(task.id, p.triggerId, row.revision, row.packet);
        } finally {
          bytes.fill(0);
        }
      }
      const bytes = vault.openPrivate(
        row.packet,
        binding(task.id, p.triggerId, row.revision),
      );
      try {
        return {
          url: `${origin}/api/events/incoming/${task.id}/${p.triggerId}`,
          token: bytes.toString(),
          enabled: task.enabled,
        };
      } finally {
        bytes.fill(0);
      }
    },
  );
  app.register(async (routes) => {
    routes.addContentTypeParser(
      "application/cloudevents+json",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          done(null, JSON.parse(String(body)));
        } catch {
          done(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
        }
      },
    );
    routes.post<{ Params: { taskId: string; triggerId: string } }>(
      incomingEventPath,
      { bodyLimit: 65536 },
      (req, reply) => {
        const { taskId, triggerId } = req.params;
        const row = read(taskId, triggerId),
          supplied = req.headers.authorization?.match(
            /^Bearer ([A-Za-z0-9_-]{43})$/,
          )?.[1];
        if (!row || !supplied)
          return reply.code(401).send({ error: "接收凭证无效" });
        const bytes = vault.openPrivate(
          row.packet,
          binding(taskId, triggerId, row.revision),
        );
        let valid = false;
        try {
          const candidate = Buffer.from(supplied);
          valid =
            bytes.length === candidate.length &&
            timingSafeEqual(bytes, candidate);
        } finally {
          bytes.fill(0);
        }
        if (!valid) return reply.code(401).send({ error: "接收凭证无效" });
        const { task, trigger } = locate(taskId, triggerId);
        if (!task.enabled || task.revision !== row.revision)
          return reply
            .code(409)
            .send({ error: "任务已暂停或变化，请重新获取接收配置" });
        const event = cloudEvent.parse(req.body);
        if (trigger.events.length && !trigger.events.includes(event.type))
          return reply.code(422).send({ error: "事件类型不匹配" });
        const result = tasks.receiveEvent(task.id, task.revision, trigger.id, {
          id: hash([event.source, event.id]),
          digest: hash(event),
          source: "incoming",
          type: event.type,
          payload: {
            ...event.data,
            eventType: event.type,
            source: event.source,
            ...(event.subject ? { subject: event.subject } : {}),
          },
        });
        return reply.code(result.duplicate ? 200 : 202).send(result);
      },
    );
  });
}
