import { webhookRoutes } from "./webhooks.js";
import Fastify from "fastify";
import { z } from "zod";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { RelayStore } from "./store.js";
export function relayServer(options: {
  directory: string;
  adminToken: string;
  now?: () => number;
  maxPending?: number;
}) {
  if (options.adminToken.length < 32)
    throw new Error("Relay admin token must contain at least 32 characters");
  const app = Fastify({ bodyLimit: 65536, logger: false }),
    store = new RelayStore(options.directory, options.now, options.maxPending);
  const token = (request: { headers: { authorization?: string } }) =>
    request.headers.authorization?.replace(/^Bearer /, "") || "";
  const hash = (s: string) => createHash("sha256").update(s).digest();
  app.post("/v1/routes", async (req, reply) => {
    if (!timingSafeEqual(hash(token(req)), hash(options.adminToken)))
      return reply.code(401).send({ error: "unauthorized" });
    return store.createRoute();
  });
  app.delete<{ Params: { id: string } }>(
    "/v1/routes/:id",
    async (req, reply) => {
      if (!timingSafeEqual(hash(token(req)), hash(options.adminToken)))
        return reply.code(401).send({ error: "unauthorized" });
      store.revoke(req.params.id);
      return { revoked: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/routes/:id/events",
    async (req, reply) => {
      if (!store.authorize(req.params.id, token(req), "producer"))
        return reply.code(401).send({ error: "unauthorized" });
      try {
        return store.publish(req.params.id, req.body);
      } catch (e) {
        const code = e instanceof Error ? e.message : "invalid_event";
        return reply
          .code(
            code === "capacity" ? 503 : code === "event_conflict" ? 409 : 400,
          )
          .send({
            error: ["capacity", "event_conflict", "event_too_large"].includes(
              code,
            )
              ? code
              : "invalid_event",
          });
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/routes/:id/subscribe",
    async (req, reply) => {
      if (!store.authorize(req.params.id, token(req), "consumer"))
        return reply.code(401).send({ error: "unauthorized" });
      const body = z
        .object({ group: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
        .parse(req.body);
      store.subscribe(req.params.id, body.group);
      return { subscribed: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/routes/:id/lease",
    async (req, reply) => {
      const body = z
        .object({
          group: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,100}$/)
            .default("default"),
          waitMs: z.number().int().min(0).max(25000).default(0),
        })
        .parse(req.body || {});
      const wait = body.waitMs;
      const deadline = Date.now() + wait;
      do {
        if (!store.authorize(req.params.id, token(req), "consumer"))
          return reply.code(401).send({ error: "unauthorized" });
        const result = store.lease(req.params.id, body.group);
        if (result.events.length || Date.now() >= deadline) return result;
        if (req.raw.destroyed) return reply.code(499).send();
        await sleep(Math.min(250, deadline - Date.now()));
      } while (true);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/routes/:id/ack",
    async (req, reply) => {
      if (!store.authorize(req.params.id, token(req), "consumer"))
        return reply.code(401).send({ error: "unauthorized" });
      const body = z
        .object({
          receipt: z.string().uuid(),
          group: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,100}$/)
            .default("default"),
        })
        .parse(req.body);
      try {
        return store.ack(req.params.id, body.receipt, body.group);
      } catch {
        return {acknowledged:false,obsolete:true};
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/routes/:id/unsubscribe",
    async (req, reply) => {
      if (!store.authorize(req.params.id, token(req), "consumer"))
        return reply.code(401).send({ error: "unauthorized" });
      const body = z
        .object({ group: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
        .parse(req.body);
      return store.unsubscribe(req.params.id, body.group);
    },
  );
  webhookRoutes(app, store);
  app.setErrorHandler((error, _req, reply) => {
    const gap = error instanceof Error && error.message === "gap";
    reply
      .code(error instanceof z.ZodError ? 400 : gap ? 409 : 500)
      .send({
        error: gap
          ? "gap"
          : error instanceof z.ZodError
            ? "invalid_request"
            : "relay_error",
      });
  });
  app.get("/health", () => ({ ok: true }));
  const timer = setInterval(() => store.cleanup(), 3600000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    store.close();
  });
  return { app, store };
}
