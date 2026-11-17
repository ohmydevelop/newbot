import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cloudEvent, type CloudEvent } from "./protocol.js";
import { relayRequest } from "./relay-request.js";
export function eventPublisher(options: {
  directory: string;
  url: string;
  token: string;
  source: string;
  caCertificate?: string;
  request?: typeof fetch;
}) {
  const url = new URL(options.url);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Publisher needs HTTPS or loopback URL");
  const http = relayRequest(url.origin, options.caCertificate);
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const file = join(options.directory, "outbox.sqlite"),
    db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL,created INTEGER NOT NULL);",
  );
  let pending: Promise<void> | undefined,
    closed = false;
  const flush = () =>
    (pending ||= (async () => {
      for (const row of db
        .prepare("SELECT id,body FROM outbox ORDER BY created,rowid LIMIT 32")
        .all()) {
        const res = await (options.request || http.request)(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + options.token,
          },
          body: row.body as string,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        await res.body?.cancel();
        if (!res.ok) throw new Error("Event relay did not accept delivery");
        db.prepare("DELETE FROM outbox WHERE id=?").run(row.id);
      }
    })().finally(() => {
      pending = undefined;
    }));
  const timer = setInterval(() => {
    if (!closed) void flush().catch(() => {});
  }, 5000);
  timer.unref();
  return {
    enqueue(
      type: string,
      data: CloudEvent["data"],
      id: string = randomUUID(),
      time = new Date().toISOString(),
    ) {
      if (closed) throw new Error("Publisher closed");
      const event = cloudEvent.parse({
        specversion: "1.0",
        id,
        source: options.source,
        type,
        time,
        data,
      });
      const body = JSON.stringify(event);
      if (Buffer.byteLength(body) > 65536) throw new Error("Event too large");
      const old = db.prepare("SELECT body FROM outbox WHERE id=?").get(id);
      if (old) {
        const previous = JSON.parse(old.body as string);
        if (
          previous.type !== type ||
          JSON.stringify(previous.data) !== JSON.stringify(data)
        )
          throw new Error("Event identity conflict");
        return id;
      }
      if (Number(db.prepare("SELECT COUNT(*) n FROM outbox").get()!.n) >= 10000)
        throw new Error("Event outbox full");
      db.prepare("INSERT OR IGNORE INTO outbox VALUES(?,?,?)").run(
        id,
        body,
        Date.now(),
      );
      return id;
    },
    flush,
    async close() {
      closed = true;
      clearInterval(timer);
      await pending?.catch(() => {});
      await http.close();
      db.close();
    },
  };
}
