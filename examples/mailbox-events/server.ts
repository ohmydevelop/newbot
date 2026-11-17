import { setTimeout as sleep } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import {
  eventServer,
  serveEvents,
} from "../../packages/event-bridge/server.js";
const server = eventServer(
  "mailbox-fixture",
  [
    {
      name: "mail.received",
      title: "收到邮件（测试）",
      delivery: ["poll", "push"],
      inputSchema: {
        type: "object",
        properties: {
          mailbox: { type: "string", title: "信箱", minLength: 1 },
          unread: { type: "boolean", title: "仅未读" },
          priority: {
            type: "string",
            title: "优先级",
            enum: ["全部", "重要"],
            default: "全部",
          },
        },
        required: ["mailbox"],
        additionalProperties: false,
      },
      payloadSchema: { type: "object" },
    },
  ],
  async (input) => {
    const path = process.env.MAILBOX_FILE;
    const rows = path
      ? (JSON.parse(await readFile(path, "utf8")) as {
          id: number;
          mailbox: string;
          subject: string;
          unread: boolean;
          important?: boolean;
        }[])
      : [];
    const cursor = Number(
      input.cursor || Math.max(0, ...rows.map((r) => r.id)),
    );
    const next = rows.filter((r) => r.id > cursor).slice(0, 32);
    return {
      cursor: String(next.at(-1)?.id || cursor),
      nextPollMs: 1000,
      events: next
        .filter(
          (r) =>
            r.mailbox === input.arguments.mailbox &&
            (!input.arguments.unread || r.unread) &&
            (input.arguments.priority !== "重要" || r.important),
        )
        .map((r) => ({
          eventId: String(r.id),
          name: "mail.received",
          timestamp: new Date(0).toISOString(),
          data: { mailbox: r.mailbox, subject: r.subject },
        })),
    };
  },
  undefined,
  async (input, emit, signal) => {
    const rows = async () =>
      process.env.MAILBOX_FILE
        ? (JSON.parse(await readFile(process.env.MAILBOX_FILE, "utf8")) as {
            id: number;
            mailbox: string;
            subject: string;
            unread: boolean;
            important?: boolean;
          }[])
        : [];
    let cursor =
      input.cursor === null
        ? Math.max(0, ...(await rows()).map((r) => r.id))
        : Number(input.cursor);
    await emit("active", { cursor: String(cursor), truncated: false });
    while (!signal.aborted) {
      await sleep(100, undefined, { signal });
      for (const row of (await rows())
        .filter((r) => r.id > cursor)
        .slice(0, 32)) {
        cursor = row.id;
        if (
          row.mailbox === input.arguments.mailbox &&
          (!input.arguments.unread || row.unread) &&
          (input.arguments.priority !== "重要" || row.important)
        )
          await emit("event", {
            eventId: String(row.id),
            name: "mail.received",
            timestamp: new Date(0).toISOString(),
            data: { mailbox: row.mailbox, subject: row.subject },
            cursor: String(cursor),
          });
      }
      await emit("heartbeat", { cursor: String(cursor) });
    }
  },
);
await serveEvents(server);
