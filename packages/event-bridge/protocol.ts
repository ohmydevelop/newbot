import { z } from "zod";
import { parseEventSchema } from "../../shared/event-schema.js";

export const EVENTS_PROFILE = "mcp-events-47d95c9";
export const eventDefinition = z.object({
  name: z.string().min(1).max(160),
  title: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  delivery: z.array(z.enum(["poll", "push", "webhook"])).min(1),
  inputSchema: z.unknown().transform(parseEventSchema),
  payloadSchema: z.record(z.string(), z.unknown()),
});
export const eventCatalogResult = z.object({
  events: z.array(eventDefinition).max(100),
  nextCursor: z.string().optional(),
});
export const occurrence = z.object({
  eventId: z.string().min(1).max(200),
  name: z.string().min(1).max(160),
  timestamp: z.string().datetime({ offset: true }),
  data: z.record(z.string(), z.json()),
  cursor: z.string().max(2048).nullable().optional(),
});
export const pollResult = z.object({
  _meta: z.record(z.string(), z.unknown()).optional(),
  events: z.array(occurrence).max(32),
  cursor: z.string().max(2048).nullable().default(null),
  nextPollMs: z.number().int().min(0).max(3600000).optional(),
  truncated: z.boolean().optional(),
});
export const cloudEvent = z.object({
  specversion: z.literal("1.0"),
  id: z.string().min(1).max(200),
  source: z.string().min(1).max(500),
  type: z.string().min(1).max(160),
  time: z.string().datetime({ offset: true }),
  subject: z.string().max(500).optional(),
  datacontenttype: z.literal("application/json").default("application/json"),
  data: z.record(z.string(), z.json()),
});
export type EventDefinition = z.infer<typeof eventDefinition>;
export type CloudEvent = z.infer<typeof cloudEvent>;
