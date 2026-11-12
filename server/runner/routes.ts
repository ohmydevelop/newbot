import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { RunnerControl } from "./control.js";
import {
  runnerEvent,
  RUNNER_PROTOCOL,
  RUNNER_PACKET_BYTES,
} from "../../shared/runner-control.js";
import { PublicError } from "../public-error.js";
export const isRunnerRoute = (url: string) =>
  [
    "/api/runner/connect",
    "/api/runner/exchange",
    "/api/runner/release",
  ].includes(url.split("?")[0]);
function identity(req: FastifyRequest) {
  return {
    id: z.string().uuid().parse(req.headers["x-newbot-node"]),
    token: z
      .string()
      .regex(/^Bearer [A-Za-z0-9_-]{43}$/)
      .parse(req.headers.authorization)
      .slice(7),
  };
}
/** Called by the main auth hook in place of browser Session/Origin auth, for these exact routes only. */
export function runnerAuthentication(
  req: FastifyRequest,
  reply: FastifyReply,
  control: RunnerControl,
) {
  if (req.headers.origin || req.headers.cookie)
    return reply.code(403).send({ error: "节点接口不接受浏览器会话" });
  try {
    const who = identity(req);
    control.authenticate(
      who.id,
      who.token,
      req.url.split("?")[0] === "/api/runner/release",
    );
  } catch {
    return reply.code(401).send({ error: "执行节点身份验证失败" });
  }
}
export function runnerRoutes(app: FastifyInstance, control: RunnerControl) {
  const lease = z.object({
    bootId: z.string().uuid(),
    epoch: z.number().int().positive().safe(),
  });
  const invoke = (
    req: FastifyRequest,
    reply: FastifyReply,
    fn: (id: string, token: string) => unknown,
  ) => {
    try {
      const who = identity(req);
      return fn(who.id, who.token);
    } catch (e) {
      return reply.code(e instanceof z.ZodError ? 400 : 409).send({
        error: e instanceof PublicError ? e.message : "节点协议校验失败",
      });
    }
  };
  app.post("/api/runner/connect", { bodyLimit: 4096 }, (req, reply) =>
    invoke(req, reply, (id, token) => {
      const hello = z
        .object({
          protocol: z.literal(RUNNER_PROTOCOL),
          bootId: z.string().uuid(),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(req.body);
      return control.connect(id, token, hello);
    }),
  );
  app.post(
    "/api/runner/exchange",
    { bodyLimit: RUNNER_PACKET_BYTES + 65536 },
    (req, reply) =>
      invoke(req, reply, (id, token) =>
        control.exchange(
          id,
          token,
          lease
            .extend({
              events: z.array(runnerEvent).max(64),
              drain: z.boolean().optional(),
            })
            .strict()
            .parse(req.body),
        ),
      ),
  );
  app.post("/api/runner/release", { bodyLimit: 4096 }, (req, reply) =>
    invoke(req, reply, (id, token) => {
      const body = lease.strict().parse(req.body);
      control.release(id, token, body.bootId, body.epoch);
      return { ok: true };
    }),
  );
  // These routes deliberately retain the application's existing browser authentication.
  app.get("/api/runners", () => ({ nodes: control.nodes() }));
  app.post("/api/runners", { bodyLimit: 4096 }, (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    return control.enroll(body.name, body.expectedFingerprint);
  });
  app.delete("/api/runners/:id", (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    control.revoke(id);
    return { ok: true };
  });
}
