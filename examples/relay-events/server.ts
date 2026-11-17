import { SourceFailure } from "../../packages/event-bridge/core.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  eventServer,
  serveEvents,
} from "../../packages/event-bridge/server.js";
import { cloudEvent } from "../../packages/event-bridge/protocol.js";
import { relayRequest } from "../../packages/event-bridge/relay-request.js";
const origin = () => {
  const url = new URL(process.env.RELAY_URL || "https://unconfigured.invalid");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Invalid relay URL");
  return url.origin;
};
const http = relayRequest(origin(), process.env.RELAY_CA_CERTIFICATE);
async function request(operation: string, body: unknown, signal?: AbortSignal) {
  const route = z.string().uuid().parse(process.env.RELAY_ROUTE);
  const res = await http.request(
    `${origin()}/v1/routes/${route}/${operation}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + (process.env.RELAY_TOKEN || ""),
      },
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(30000),
      redirect: "error",
    },
  );
  if (!res.ok)
    throw new SourceFailure(
      res.status === 401
        ? "auth_required"
        : res.status === 409
          ? "gap"
          : "retry",
    );
  return res.json();
}
const server = eventServer(
  "relay-events",
  [
    {
      name: "event.received",
      title: "收到事件",
      delivery: ["poll"],
      inputSchema: {
        type: "object",
        properties: {
          types: {
            type: "string",
            title: "事件类型",
            description: "多个类型使用逗号分隔",
          },
        },
        additionalProperties: false,
      },
      payloadSchema: { type: "object" },
    },
  ],
  async (input, signal) => {
    const group = createHash("sha256")
      .update(
        JSON.stringify([
          input._meta?.["io.newbot/consumer"] || "default",
          input.name,
          input.arguments.types || "",
        ]),
      )
      .digest("hex");
    if (input.cursor === null) {
      await request("subscribe", { group }, signal);
      return { cursor: "subscribed", events: [], nextPollMs: 1000 };
    }
    const page = z
      .object({
        receipt: z.string().nullable(),
        events: z.array(cloudEvent).max(32),
      })
      .parse(await request("lease", { group, waitMs: 0 }, signal));
    const types = String(input.arguments.types || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return {
      cursor: "subscribed",
      nextPollMs: 1000,
      _meta: page.receipt
        ? {
            "io.newbot/receipt": JSON.stringify({
              group,
              receipt: page.receipt,
            }),
          }
        : {},
      events: page.events
        .filter((e) => !types.length || types.includes(e.type))
        .map((e) => ({
          eventId: createHash("sha256")
            .update(JSON.stringify([e.source, e.id]))
            .digest("hex"),
          name: "event.received",
          timestamp: e.time,
          data: {
            ...e.data,
            eventType: e.type,
            source: e.source,
            subject: e.subject || "",
          },
        })),
    };
  },
  async (receipt) => {
    await request(
      "ack",
      z
        .object({ group: z.string(), receipt: z.string().uuid() })
        .parse(JSON.parse(receipt)),
    );
  },
);
await serveEvents(server);
