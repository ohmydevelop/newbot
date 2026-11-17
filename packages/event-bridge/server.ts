import { SourceFailure } from "./core.js";
import { McpServer, ProtocolError } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  eventCatalogResult,
  pollResult,
  type EventDefinition,
} from "./protocol.js";
import { schemaValidator } from "../../shared/event-schema.js";

export function eventServer(
  name: string,
  definitions: EventDefinition[],
  poll: (
    input: {
      _meta?: Record<string, unknown>;
      name: string;
      arguments: Record<string, unknown>;
      cursor: string | null;
    },
    signal: AbortSignal,
  ) => Promise<z.infer<typeof pollResult>>,
  acknowledge?: (receipt: string) => Promise<void>,
  stream?: (
    input: {
      _meta?: Record<string, unknown>;
      name: string;
      arguments: Record<string, unknown>;
      cursor: string | null;
    },
    emit: (kind: string, value: Record<string, unknown>) => Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>,
) {
  const server = new McpServer(
    { name, version: "1.0.0" },
    {
      capabilities: {
        experimental: { "io.newbot/events": { profile: "mcp-events-47d95c9" } },
      },
    },
  );
  server.server.setRequestHandler(
    "events/list",
    {
      params: z.object({ cursor: z.string().optional() }).default({}),
      result: eventCatalogResult,
    },
    () => ({ events: definitions }),
  );
  server.server.setRequestHandler(
    "events/poll",
    {
      params: z.object({
        _meta: z.record(z.string(), z.unknown()).optional(),
        name: z.string(),
        arguments: z.record(z.string(), z.unknown()),
        cursor: z.string().nullable().default(null),
      }),
      result: pollResult,
    },
    async (input, ctx) => {
      const definition = definitions.find((d) => d.name === input.name);
      if (!definition || !definition.delivery.includes("poll"))
        throw new Error("Unsupported event");
      schemaValidator(definition.inputSchema).parse(input.arguments);
      try {
        return await poll(input, ctx.mcpReq.signal);
      } catch (error) {
        if (error instanceof SourceFailure)
          throw new ProtocolError(-32000, error.code, {
            "io.newbot/failure": error.code,
            retryAfterMs: error.retryAfterMs,
          });
        throw error;
      }
    },
  );
  if (stream)
    server.server.setRequestHandler(
      "events/stream",
      {
        params: z.object({
          _meta: z.record(z.string(), z.unknown()).optional(),
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()),
          cursor: z.string().nullable().default(null),
        }),
        result: z.object({}),
      },
      async (input, ctx) => {
        const definition = definitions.find((d) => d.name === input.name);
        if (!definition?.delivery.includes("push"))
          throw new Error("Unsupported event");
        schemaValidator(definition.inputSchema).parse(input.arguments);
        await stream(
          input,
          (kind, value) =>
            ctx.mcpReq.notify({
              method: "notifications/events/" + kind,
              params: {
                ...value,
                _meta: {
                  "io.modelcontextprotocol/subscriptionId": ctx.mcpReq.id,
                },
              },
            }),
          ctx.mcpReq.signal,
        );
        return {};
      },
    );
  if (acknowledge)
    server.server.setRequestHandler(
      "io.newbot/events/ack",
      {
        params: z.object({ receipt: z.string().max(2048) }),
        result: z.object({ ok: z.boolean() }),
      },
      async ({ receipt }) => {
        await acknowledge(receipt);
        return { ok: true };
      },
    );
  return server;
}
export async function serveEvents(server: McpServer) {
  await server.connect(new StdioServerTransport());
}
