import type { webhookDelivery } from "./webhook.js";
import { Ajv } from "@modelcontextprotocol/client/validators/ajv";
import { z } from "zod";
import {
  eventCatalogResult,
  pollResult,
} from "../../packages/event-bridge/protocol.js";
import { schemaValidator } from "../../shared/event-schema.js";
import { SourceFailure, type PullAdapter } from "./contracts.js";
import { EventStream } from "./stream.js";
import type { EventPeer } from "./connection.js";

export async function discoverEvents(peer: EventPeer) {
  const all = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const result = eventCatalogResult.parse(
      await peer.request("events/list", cursor ? { cursor } : {}),
    );
    all.push(...result.events);
    cursor = result.nextCursor;
    if (all.length > 100 || (cursor && seen.has(cursor)))
      throw new SourceFailure("conflict");
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (new Set(all.map((e) => e.name)).size !== all.length)
    throw new SourceFailure("conflict");
  return all;
}
export function mcpEventAdapter(
  connect: (id: string, scope?: string) => Promise<EventPeer>,
  webhook?: ReturnType<typeof webhookDelivery>,
): PullAdapter {
  const streams = new Map<string, EventStream>();
  return {
    async pull(context) {
      const resource = z
        .object({
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()),
        })
        .parse(JSON.parse(context.resource));
      const peer = await connect(context.connectionId, context.resource);
      const definitions = await discoverEvents(peer);
      const definition = definitions.find((d) => d.name === resource.name);
      if (
        !definition ||
        !definition.delivery.some(
          (mode) =>
            mode === "poll" ||
            mode === "push" ||
            (mode === "webhook" && !!webhook),
        )
      )
        throw new SourceFailure("conflict");
      resource.arguments = schemaValidator(definition.inputSchema).parse(
        resource.arguments,
      ) as Record<string, unknown>;
      const checkpoint =
        context.cursor === null
          ? undefined
          : z
              .object({ cursor: z.string().nullable() })
              .parse(JSON.parse(context.cursor));
      const key = context.connectionId + ":" + context.resource;
      let stream = streams.get(key);
      if (stream?.failed) {
        stream.stop();
        streams.delete(key);
        stream = undefined;
      }
      let result: z.infer<typeof pollResult>;
      if (definition.delivery.includes("push") && peer.stream) {
        if (!stream) {
          stream = new EventStream(peer, {
            name: resource.name,
            arguments: resource.arguments,
            cursor: checkpoint?.cursor ?? null,
          });
          streams.set(key, stream);
        }
        const page = await stream.read(!checkpoint, context.signal);
        result = {
          events: page.events,
          cursor:
            page.cursor === undefined
              ? (checkpoint?.cursor ?? null)
              : page.cursor,
          nextPollMs: 1000,
          _meta: page.receipt ? { "io.newbot/receipt": page.receipt } : {},
        };
      } else if (!definition.delivery.includes("poll") && webhook)
        result = await webhook.pull(peer, context, {
          name: resource.name,
          arguments: resource.arguments,
          cursor: checkpoint?.cursor ?? null,
        });
      else
        result = pollResult.parse(
          await peer.request(
            "events/poll",
            {
              _meta: { "io.newbot/consumer": context.connectionId },
              name: resource.name,
              arguments: resource.arguments,
              cursor: checkpoint?.cursor ?? null,
            },
            context.signal,
          ),
        );
      if (result.truncated) throw new SourceFailure("gap");
      const validator = new Ajv({ strict: false, allErrors: false }).compile(
        definition.payloadSchema,
      );
      if (result.events.some((e) => !validator(e.data)))
        throw new SourceFailure("conflict");
      if (result.events.some((e) => e.name !== resource.name))
        throw new SourceFailure("conflict");
      return {
        cursor: JSON.stringify({ cursor: result.cursor }),
        events: checkpoint
          ? result.events.map((e) => ({
              id: e.eventId,
              type: e.name,
              payload: { ...e.data },
              envelope: {
                specversion: "1.0" as const,
                id: e.eventId,
                source: context.connectionId,
                type: e.name,
                time: e.timestamp,
                datacontenttype: "application/json" as const,
                data: e.data,
              },
            }))
          : [],
        nextPollMs: result.nextPollMs,
        ...(typeof result._meta?.["io.newbot/receipt"] === "string"
          ? { receipt: result._meta["io.newbot/receipt"] as string }
          : {}),
      };
    },
    async acknowledge(context, receipt) {
      if (receipt.startsWith("hook:") && webhook) {
        await webhook.acknowledge(context, receipt);
        return;
      }
      if (receipt.startsWith("stream:")) {
        streams
          .get(context.connectionId + ":" + context.resource)
          ?.acknowledge(receipt);
        return;
      }
      await (
        await connect(context.connectionId, context.resource)
      ).request("io.newbot/events/ack", { receipt }, context.signal);
    },
  };
}
