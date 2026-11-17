import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import { eventCatalogResult, pollResult } from "./protocol.js";
import { eventPublisher } from "./publisher.js";
import { hash, eventFailure, SourceFailure } from "./core.js";
import { schemaValidator } from "../../shared/event-schema.js";

export type ForwarderOptions = {
  directory: string;
  source: string;
  server: { command: string; args: string[]; env?: Record<string, string> };
  event: string;
  arguments: Record<string, unknown>;
  relay: { url: string; token: string; caCertificate?: string };
};
export async function eventForwarder(options: ForwarderOptions) {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const file = join(options.directory, "checkpoint.sqlite"),
    db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS checkpoint(id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL,cursor TEXT,receipt TEXT)",
  );
  const binding = hash({
    source: options.source,
    command: options.server.command,
    args: options.server.args,
    event: options.event,
    arguments: options.arguments,
    relay: options.relay.url,
  });
  const existing = db
    .prepare("SELECT binding FROM checkpoint WHERE id=1")
    .get();
  if (existing && existing.binding !== binding) {
    db.close();
    throw new Error(
      "Bridge configuration changed; use a separate state directory",
    );
  }
  db.prepare("INSERT OR IGNORE INTO checkpoint VALUES(1,?,NULL,NULL)").run(
    binding,
  );
  const publisher = eventPublisher({
    ...options.relay,
    source: options.source,
    directory: join(options.directory, "outbox"),
  });
  const client = new Client(
    { name: "newbot-outbound-bridge", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport = new StdioClientTransport({
    ...options.server,
    env: { PATH: process.env.PATH || "", ...options.server.env },
    stderr: "ignore",
  });
  let closed = false,
    busy = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await client.close();
    await publisher.close();
    db.close();
  };
  try {
    await client.connect(transport, { timeout: 10000 });
    const definitions = await client.request(
      { method: "events/list", params: {} },
      eventCatalogResult,
      { timeout: 15000 },
    );
    const definition = definitions.events.find(
      (e) => e.name === options.event && e.delivery.includes("poll"),
    );
    if (!definition)
      throw new Error("Configured poll event is not offered by the plugin");
    schemaValidator(definition.inputSchema).parse(options.arguments);
  } catch (error) {
    await close();
    throw error;
  }
  async function acknowledge(receipt: string) {
    await client.request(
      { method: "io.newbot/events/ack", params: { receipt } },
      z.record(z.string(), z.unknown()),
      { timeout: 15000 },
    );
    db.prepare("UPDATE checkpoint SET receipt=NULL WHERE id=1").run();
  }
  return {
    async tick() {
      if (closed || busy)
        throw new Error("Bridge is closed or already polling");
      busy = true;
      try {
        const state = db
          .prepare("SELECT cursor,receipt FROM checkpoint WHERE id=1")
          .get()!;
        if (state.receipt) await acknowledge(String(state.receipt));
        const page = await client.request(
          {
            method: "events/poll",
            params: {
              name: options.event,
              arguments: options.arguments,
              cursor: state.cursor,
              _meta: { "io.newbot/consumer": binding },
            },
          },
          pollResult,
          { timeout: 30000 },
        );
        if (page.truncated) throw new SourceFailure("gap");
        if (page.events.some((e) => e.name !== options.event))
          throw new SourceFailure("conflict");
        for (const event of page.events)
          publisher.enqueue(
            event.name,
            event.data,
            hash([binding, event.eventId]),
            event.timestamp,
          );
        const receipt = page._meta?.["io.newbot/receipt"];
        if (receipt !== undefined && typeof receipt !== "string")
          throw new SourceFailure("conflict");
        db.prepare("UPDATE checkpoint SET cursor=?,receipt=? WHERE id=1").run(
          page.cursor,
          receipt || null,
        );
        if (receipt) await acknowledge(receipt);
        await publisher.flush();
        return {
          events: page.events.length,
          nextPollMs: Math.max(1000, page.nextPollMs ?? 60000),
        };
      } catch (error) {
        throw eventFailure(error);
      } finally {
        busy = false;
      }
    },
    close,
  };
}
