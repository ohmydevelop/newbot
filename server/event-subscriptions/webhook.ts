import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Store } from "../db.js";
import type { credentialVault } from "../credential-vault.js";
import type { EventPeer } from "./connection.js";
import { hash, SourceFailure, type PullContext } from "./contracts.js";
import {
  cloudEvent,
  occurrence,
} from "../../packages/event-bridge/protocol.js";

type State = {
  connection: string;
  resource: string;
  secret: string;
  subscription?: string;
  cursor: string | null;
  refresh: number;
};
export type RelayConfiguration = {
  url: string;
  route: string;
  token: string;
  request?: typeof fetch;
};
export function webhookDelivery(
  db: Store,
  vault: Pick<
    ReturnType<typeof credentialVault>,
    "sealPrivate" | "openPrivate"
  >,
  relay: RelayConfiguration,
  connect: (id: string, scope: string) => Promise<EventPeer>,
) {
  const base = new URL(relay.url);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Event webhook relay requires an HTTPS URL");
  z.string().uuid().parse(relay.route);
  const keyFor = (context: Pick<PullContext, "connectionId" | "resource">) =>
    hash([base.href, relay.route, context.connectionId, context.resource]);
  const address = (key: string) =>
    `${base.origin}/v1/routes/${relay.route}/hooks/${key}/delivery`;
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
  async function request(
    path: string,
    body: unknown,
    method = "POST",
    signal = AbortSignal.timeout(10000),
  ) {
    const response = await (relay.request || fetch)(
      `${base.origin}/v1/routes/${relay.route}/${path}`,
      {
        method,
        headers: {
          authorization: "Bearer " + relay.token,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceFailure(
        response.status === 401
          ? "auth_required"
          : response.status === 409
            ? "gap"
            : "retry",
      );
    }
    return response.json();
  }
  return {
    keyFor,
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
        await request(
          "hooks/" + key,
          { secret: state.secret, subscription: state.subscription },
          "PUT",
          context.signal,
        );
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
        await request(
          "hooks/" + key,
          { secret: state.secret, subscription: state.subscription },
          "PUT",
          context.signal,
        );
        save(key, state);
      }
      if (context.cursor === null)
        return { events: [], cursor: state.cursor, nextPollMs: 1000 };
      const page = z
        .object({
          events: z.array(cloudEvent).max(32),
          receipt: z.string().uuid().nullable(),
        })
        .parse(await request("lease", { group: key }, "POST", context.signal));
      const frames = page.events.filter(
        (e) => e.source === "urn:newbot:hook:" + key,
      );
      if (frames.some((e) => e.data.type === "gap"))
        throw new SourceFailure("gap");
      if (frames.some((e) => e.data.type === "terminated"))
        throw new SourceFailure("auth_required");
      const events = frames.map((e) => occurrence.parse(e.data));
      return {
        events,
        cursor: state.cursor,
        nextPollMs: 1000,
        _meta: page.receipt
          ? {
              "io.newbot/receipt":
                "hook:" + JSON.stringify({ key, receipt: page.receipt }),
            }
          : {},
      };
    },
    async acknowledge(context: PullContext, receipt: string) {
      const p = z
        .object({ key: z.string(), receipt: z.string().uuid() })
        .parse(JSON.parse(receipt.slice(5)));
      if (p.key !== keyFor(context)) throw new SourceFailure("conflict");
      await request(
        "ack",
        { group: p.key, receipt: p.receipt },
        "POST",
        context.signal,
      );
    },
    async reconcile(wanted: Set<string>) {
      for (const row of db.raw
        .prepare("SELECT id FROM automation_event_webhooks")
        .all()) {
        const key = row.id as string;
        if (wanted.has(key)) continue;
        const state = read(key)!;
        try {
          await request("hooks/" + key, undefined, "DELETE");
        } catch {
          continue;
        }
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
        } catch {
          /* Finite upstream TTL bounds cleanup after credentials are revoked. */
        }
        db.raw
          .prepare("DELETE FROM automation_event_webhooks WHERE id=?")
          .run(key);
      }
    },
  };
}
