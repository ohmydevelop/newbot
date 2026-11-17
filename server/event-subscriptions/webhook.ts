import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Store } from "../db.js";
import type { credentialVault } from "../credential-vault.js";
import type { EventPeer } from "./connection.js";
import { hash, SourceFailure, type PullContext } from "./contracts.js";
import { occurrence } from "../../packages/event-bridge/protocol.js";
import { pluginEventPath } from "./ingress.js";

type State = {
  connection: string;
  resource: string;
  secret: string;
  subscription?: string;
  cursor: string | null;
  refresh: number;
};
export function webhookDelivery(
  db: Store,
  vault: Pick<
    ReturnType<typeof credentialVault>,
    "sealPrivate" | "openPrivate"
  >,
  origin: string,
  connect: (id: string, scope: string) => Promise<EventPeer>,
  active: (connection: string, resource: string) => boolean = () => true,
) {
  const base = new URL(origin);
  if (
    base.origin !== origin ||
    (base.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  )
    throw new Error("Event callback requires HTTPS or loopback HTTP");
  db.raw.exec(`CREATE TABLE IF NOT EXISTS automation_webhook_inbox (
    hook TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,body TEXT,PRIMARY KEY(hook,id));`);
  const keyFor = (context: Pick<PullContext, "connectionId" | "resource">) =>
    hash([base.origin, context.connectionId, context.resource]);
  const address = (key: string) => `${base.origin}/api/events/plugins/${key}`;
  const read = (key: string): State | undefined => {
    const row = db.raw
      .prepare("SELECT packet FROM automation_event_webhooks WHERE id=?")
      .get(key);
    if (!row) return;
    const bytes = vault.openPrivate(row.packet as string, "webhook:" + key);
    try {
      return JSON.parse(bytes.toString());
    } finally {
      bytes.fill(0);
    }
  };
  const save = (key: string, value: State) => {
    const bytes = Buffer.from(JSON.stringify(value));
    try {
      db.raw
        .prepare(
          "INSERT INTO automation_event_webhooks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET packet=excluded.packet",
        )
        .run(key, vault.sealPrivate(bytes, "webhook:" + key));
    } finally {
      bytes.fill(0);
    }
  };
  return {
    keyFor,
    register(app: FastifyInstance) {
      app.register(async (routes) => {
        routes.removeContentTypeParser("application/json");
        routes.addContentTypeParser(
          "application/json",
          { parseAs: "string" },
          (_req, body, done) => done(null, body),
        );
        routes.post<{ Params: { key: string } }>(
          pluginEventPath,
          { bodyLimit: 65536 },
          (req, reply) => {
            const key = req.params.key,
              state = read(key);
            if (!state || !active(state.connection, state.resource))
              return reply.code(410).send({ error: "unavailable" });
            const id = req.headers["webhook-id"],
              stamp = req.headers["webhook-timestamp"],
              signature = req.headers["webhook-signature"],
              subscription = req.headers["x-mcp-subscription-id"];
            if (
              typeof id !== "string" ||
              !id ||
              id.length > 200 ||
              typeof stamp !== "string" ||
              !/^\d+$/.test(stamp) ||
              Math.abs(Date.now() / 1000 - Number(stamp)) > 300 ||
              typeof signature !== "string"
            )
              return reply.code(401).send({ error: "invalid_signature" });
            const expected = createHmac(
              "sha256",
              Buffer.from(state.secret.slice(6), "base64"),
            )
              .update(`${id}.${stamp}.${req.body as string}`)
              .digest();
            if (
              !signature.split(" ").some((part) => {
                const [version, value] = part.split(","),
                  actual = Buffer.from(value || "", "base64");
                return (
                  version === "v1" &&
                  actual.length === expected.length &&
                  timingSafeEqual(actual, expected)
                );
              })
            )
              return reply.code(401).send({ error: "invalid_signature" });
            let body: Record<string, unknown>;
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
            if (!state.subscription)
              return reply.code(425).send({ error: "subscription_pending" });
            if (subscription !== state.subscription)
              return reply.code(401).send({ error: "invalid_subscription" });
            try {
              if (body.type)
                z.object({ type: z.enum(["gap", "terminated"]) }).parse(body);
              else {
                const event = occurrence.parse(body);
                if (
                  event.eventId !== id ||
                  event.name !== JSON.parse(state.resource).name
                )
                  throw new Error("invalid_identity");
              }
            } catch {
              return reply.code(400).send({ error: "invalid_event" });
            }
            const { cursor: _cursor, ...identity } = body,
              digest = hash(identity);
            const prior = db.raw
              .prepare(
                "SELECT digest FROM automation_webhook_inbox WHERE hook=? AND id=?",
              )
              .get(key, id);
            if (prior)
              return prior.digest === digest
                ? { accepted: true, duplicate: true }
                : reply.code(409).send({ error: "event_conflict" });
            if (
              Number(
                db.raw
                  .prepare("SELECT count(*) AS n FROM automation_webhook_inbox")
                  .get()!.n,
              ) >= 100000
            )
              return reply.code(503).send({ error: "capacity" });
            db.raw
              .prepare("INSERT INTO automation_webhook_inbox VALUES(?,?,?,?)")
              .run(key, id, digest, JSON.stringify(body));
            return { accepted: true, duplicate: false };
          },
        );
      });
    },
    async pull(
      peer: EventPeer,
      context: PullContext,
      input: {
        name: string;
        arguments: Record<string, unknown>;
        cursor: string | null;
      },
    ) {
      const key = keyFor(context);
      let state = read(key);
      if (!state) {
        state = {
          connection: context.connectionId,
          resource: context.resource,
          secret: "whsec_" + randomBytes(32).toString("base64"),
          cursor: input.cursor,
          refresh: 0,
        };
        save(key, state);
      }
      if (state.refresh <= Date.now()) {
        const result = z
          .object({
            id: z.string().min(1).max(200),
            cursor: z.string().max(2048).nullable().default(null),
            refreshBefore: z.string().datetime({ offset: true }).nullable(),
            truncated: z.boolean().optional(),
          })
          .parse(
            await peer.request(
              "events/subscribe",
              {
                name: input.name,
                arguments: input.arguments,
                delivery: {
                  mode: "webhook",
                  url: address(key),
                  secret: state.secret,
                },
                cursor: input.cursor,
                ttlMs: 3600000,
              },
              context.signal,
            ),
          );
        if (result.truncated) throw new SourceFailure("gap");
        if (
          result.refreshBefore &&
          Date.parse(result.refreshBefore) <= Date.now()
        )
          throw new SourceFailure("conflict");
        state = {
          ...state,
          subscription: result.id,
          cursor: result.cursor,
          refresh: result.refreshBefore
            ? Date.now() +
              Math.max(1, (Date.parse(result.refreshBefore) - Date.now()) * 0.8)
            : Date.now() + 3600000,
        };
        save(key, state);
      }
      if (context.cursor === null)
        return { events: [], cursor: state.cursor, nextPollMs: 1000 };
      const rows = db.raw
        .prepare(
          "SELECT id,body FROM automation_webhook_inbox WHERE hook=? AND body IS NOT NULL ORDER BY rowid LIMIT 32",
        )
        .all(key);
      const frames = rows.map((r) => JSON.parse(r.body as string));
      if (frames.some((e) => e.type === "gap")) throw new SourceFailure("gap");
      if (frames.some((e) => e.type === "terminated"))
        throw new SourceFailure("auth_required");
      return {
        events: frames.map((e) => occurrence.parse(e)),
        cursor: state.cursor,
        nextPollMs: 1000,
        _meta: rows.length
          ? {
              "io.newbot/receipt":
                "hook:" + JSON.stringify({ key, ids: rows.map((r) => r.id) }),
            }
          : {},
      };
    },
    async acknowledge(context: PullContext, receipt: string) {
      const p = z
        .object({ key: z.string(), ids: z.array(z.string()).max(32) })
        .parse(JSON.parse(receipt.slice(5)));
      if (p.key !== keyFor(context)) throw new SourceFailure("conflict");
      for (const id of p.ids)
        db.raw
          .prepare(
            "UPDATE automation_webhook_inbox SET body=NULL WHERE hook=? AND id=?",
          )
          .run(p.key, id);
    },
    async reconcile(wanted: Set<string>) {
      for (const row of db.raw
        .prepare("SELECT id FROM automation_event_webhooks")
        .all()) {
        const key = row.id as string;
        if (wanted.has(key)) continue;
        const state = read(key)!;
        db.raw
          .prepare("DELETE FROM automation_event_webhooks WHERE id=?")
          .run(key);
        db.raw
          .prepare("DELETE FROM automation_webhook_inbox WHERE hook=?")
          .run(key);
        try {
          const peer = await connect(state.connection, state.resource),
            input = JSON.parse(state.resource);
          await peer.request(
            "events/unsubscribe",
            {
              name: input.name,
              arguments: input.arguments,
              delivery: { url: address(key) },
            },
            AbortSignal.timeout(5000),
          );
        } catch {}
      }
    },
  };
}
