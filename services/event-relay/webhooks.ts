import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { RelayStore } from "./store.js";
import { occurrence } from "../../packages/event-bridge/protocol.js";
export function webhookRoutes(app: FastifyInstance, store: RelayStore) {
  app.register(async (routes) => {
    routes.removeContentTypeParser("application/json");
    routes.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => done(null, body),
    );
    routes.post<{ Params: { id: string; key: string } }>(
      "/v1/routes/:id/hooks/:key/delivery",
      async (req, reply) => {
        const hook = store.hook(req.params.id, req.params.key);
        if (!hook) return reply.code(410).send({ error: "unavailable" });
        const id = req.headers["webhook-id"],
          stamp = req.headers["webhook-timestamp"],
          signature = req.headers["webhook-signature"],
          subscription = req.headers["x-mcp-subscription-id"];
        if (
          typeof id !== "string" ||
          id.length > 200 ||
          typeof stamp !== "string" ||
          !/^\d+$/.test(stamp) ||
          typeof signature !== "string" ||
          typeof subscription !== "string" ||
          subscription.length > 200 ||
          Math.abs(Date.now() / 1000 - Number(stamp)) > 300
        )
          return reply.code(401).send({ error: "invalid_signature" });
        const expected = createHmac(
          "sha256",
          Buffer.from(hook.secret.slice(6), "base64"),
        )
          .update(`${id}.${stamp}.${req.body as string}`)
          .digest();
        const valid = signature.split(" ").some((part) => {
          const [version, value] = part.split(",");
          const actual = Buffer.from(value || "", "base64");
          return (
            version === "v1" &&
            actual.length === expected.length &&
            timingSafeEqual(actual, expected)
          );
        });
        if (!valid) return reply.code(401).send({ error: "invalid_signature" });
        let body: Record<string, any>;
        try {
          body = z
            .record(z.string(), z.json())
            .parse(JSON.parse(req.body as string));
        } catch {
          return reply.code(400).send({ error: "invalid_event" });
        }
        if (body.type === "verification")
          return typeof body.challenge === "string" &&
            body.challenge.length <= 1024
            ? { challenge: body.challenge }
            : reply.code(400).send({ error: "invalid_challenge" });
        if (!hook.subscription)
          return reply.code(425).send({ error: "subscription_pending" });
        if (subscription !== hook.subscription)
          return reply.code(401).send({ error: "invalid_subscription" });
        try {
          if (body.type) {
            z.object({ type: z.enum(["gap", "terminated"]) }).parse(body);
          } else {
            occurrence.parse(body);
            if (body.eventId !== id) throw new Error("invalid_identity");
          }
          return store.publishHook(req.params.id, req.params.key, id, body);
        } catch (error) {
          return reply
            .code(
              error instanceof Error && error.message === "capacity"
                ? 503
                : 400,
            )
            .send({ error: "event_not_accepted" });
        }
      },
    );
  });
  const auth = (req: {
    headers: { authorization?: string };
    params: { id: string };
  }) =>
    store.authorize(
      req.params.id,
      req.headers.authorization?.replace(/^Bearer /, "") || "",
      "consumer",
    );
  app.put<{ Params: { id: string; key: string } }>(
    "/v1/routes/:id/hooks/:key",
    async (req, reply) => {
      if (!auth(req)) return reply.code(401).send({ error: "unauthorized" });
      const key = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(req.params.key);
      const body = z
        .object({
          secret: z
            .string()
            .regex(/^whsec_[A-Za-z0-9+/]+={0,2}$/)
            .refine((v) => {
              const size = Buffer.from(v.slice(6), "base64").length;
              return size >= 24 && size <= 64;
            }),
          subscription: z.string().min(1).max(200).optional(),
        })
        .parse(req.body);
      store.saveHook(req.params.id, key, body);
      return { ready: true };
    },
  );
  app.delete<{ Params: { id: string; key: string } }>(
    "/v1/routes/:id/hooks/:key",
    async (req, reply) => {
      if (!auth(req)) return reply.code(401).send({ error: "unauthorized" });
      store.removeHook(req.params.id, req.params.key);
      return { removed: true };
    },
  );
}
