import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { isolatedProvider } from "./isolated-provider.js";

/** Keep the existing authenticated server boundary; narrow its public API. */
export function restrictPreview(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    const read = request.method === "GET" || request.method === "HEAD";
    const allowed = read
      ? /^(?:\/|\/favicon\.ico|\/assets\/[^/]+|\/api\/session|\/api\/copilot\/info|\/api\/threads\/[a-zA-Z0-9-]+)$/.test(
          path,
        )
      : request.method === "POST" &&
        /^(?:\/api\/(?:login|logout)|\/api\/v1\/threads|\/api\/copilot\/agent\/newbot\/(?:run|connect|stop\/[a-zA-Z0-9-]+))$/.test(
          path,
        );
    if (!allowed) return reply.code(404).send({ error: "Not found" });
  });
}

/** Bootstrap once. Never copy sessions, replace existing data, or delete it on exit. */
export function preparePreview(root: string, source: string) {
  const work = join(root, ".data/v1-online");
  if (!existsSync(work)) {
    const temporary = isolatedProvider(root, source);
    try {
      const original = new DatabaseSync(join(source, "newbot.sqlite"), {
        readOnly: true,
      });
      let password: string;
      try {
        const row = original
          .prepare("SELECT value FROM metadata WHERE key='password'")
          .get();
        if (!row || typeof row.value !== "string")
          throw new Error("Original login is required");
        password = row.value;
      } finally {
        original.close();
      }
      const target = new DatabaseSync(
        join(temporary.directory, "newbot.sqlite"),
      );
      try {
        target
          .prepare("INSERT INTO metadata(key,value) VALUES('password',?)")
          .run(password);
      } finally {
        target.close();
      }
      renameSync(temporary.work, work);
    } catch (error) {
      rmSync(temporary.work, { recursive: true, force: true });
      throw error;
    }
  }
  if (!existsSync(join(work, "server/newbot.sqlite")))
    throw new Error("Preview data is incomplete");
  return { directory: join(work, "server"), cwd: join(work, "workspace") };
}
