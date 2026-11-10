import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
const port = Number(process.env.RECOVERY_FLOW_TEST_PORT || 3136),
  origin = `http://127.0.0.1:${port}`,
  directory = mkdtempSync(join(tmpdir(), "newbot-recovery-ui-")),
  cwd = join(directory, "workspace");
mkdirSync(cwd);
const codex = new FakeCodex();
let turns = 0,
  interrupts = 0,
  pages = 0,
  uploads = 0,
  failPage = false,
  failRename = false,
  failArchive = false,
  holdPage = false,
  holdArchive = false,
  holdUpload = false,
  ignoreStop = false;
let pageRelease: undefined | (() => void),
  archiveRelease: undefined | (() => void),
  uploadRelease: undefined | (() => void);
for (const [id, name, count] of [
  ["alpha", "Alpha History", 65],
  ["beta", "Beta Chat", 1],
  ["archive", "Archive Chat", 1],
] as const) {
  codex.threads.set(id, {
    id,
    name,
    modelProvider: "fixture",
    status: { type: "idle" },
    preview: name,
    updatedAt: Date.now() / 1000,
    turns: Array.from({ length: count }, (_, i) => ({
      id: `${id}-${i}`,
      status: "completed",
      items: [
        {
          id: `${id}-${i}-u`,
          type: "userMessage",
          content: [{ type: "text", text: `${name} prompt ${i}` }],
        },
        {
          id: `${id}-${i}-a`,
          type: "agentMessage",
          text: `${name} answer ${i}\n\n${"Readable history line. ".repeat(10)}`,
        },
      ],
      error: null,
    })),
  });
}
const base = codex.call.bind(codex);
codex.call = (async (method: any, p: any) => {
  if (method === "thread/turns/list") {
    if (p.cursor) {
      pages++;
      if (holdPage) await new Promise<void>((r) => (pageRelease = r));
      if (failPage) {
        failPage = false;
        throw new Error("page fixture failure");
      }
    }
    const all = [...(codex.threads.get(p.threadId)?.turns || [])].reverse(),
      offset = p.cursor ? Number(p.cursor.slice(5)) : 0,
      start = offset === 30 ? 29 : offset;
    return {
      data: all.slice(start, offset + 30),
      nextCursor: offset + 30 < all.length ? `page-${offset + 30}` : null,
    };
  }
  if (method === "thread/name/set" && failRename) {
    failRename = false;
    throw new Error("rename fixture failure");
  }
  if (method === "thread/archive") {
    if (failArchive) {
      failArchive = false;
      throw new Error("archive fixture failure");
    }
    if (holdArchive) await new Promise<void>((r) => (archiveRelease = r));
  }
  if (method === "turn/interrupt") {
    interrupts++;
    if (ignoreStop) return {};
  }
  const result: any = await base(method, p);
  if (method === "thread/name/set")
    codex.threads.get(p.threadId)!.name = p.name;
  if (method === "turn/start") {
    turns++;
    const text = p.input.find((i: any) => i.type === "text")?.text || "";
    if (!text.includes("hold"))
      setTimeout(() => {
        codex.item(
          p.threadId,
          result.turn.id,
          {
            id: `answer-${turns}`,
            type: "agentMessage",
            text: `Received: ${text}`,
          },
          true,
        );
        codex.finish(p.threadId);
      }, 100);
  }
  return result;
}) as typeof codex.call;
const ctx = await createServer({
    providerRuntime: null,
  directory,
  cwd,
  codex,
  password: "recovery-ui-fixture-login",
  origins: [origin],
});
for (const [id, title] of [
  ["alpha", "Alpha History"],
  ["beta", "Beta Chat"],
  ["archive", "Archive Chat"],
]) {
  ctx.db.addThread(id, "fixture");
  ctx.db.rename(id, title);
}
ctx.app.addHook("onRequest", async (req) => {
  if (req.url.startsWith("/api/attachments")) {
    uploads++;
    if (holdUpload && req.url.includes("slow.txt"))
      await new Promise<void>((r) => (uploadRelease = r));
  }
});
ctx.app.addHook("preClose", async () => {
  pageRelease?.();
  archiveRelease?.();
  uploadRelease?.();
});
ctx.app.post("/api/test/recovery", async (req) => {
  const action = (req.body as any)?.action;
  if (action === "fail-page") failPage = true;
  if (action === "hold-page") holdPage = true;
  if (action === "release-page") {
    holdPage = false;
    pageRelease?.();
  }
  if (action === "fail-rename") failRename = true;
  if (action === "fail-archive") failArchive = true;
  if (action === "hold-archive") holdArchive = true;
  if (action === "release-archive") {
    holdArchive = false;
    archiveRelease?.();
  }
  if (action === "hold-upload") holdUpload = true;
  if (action === "release-upload") {
    holdUpload = false;
    uploadRelease?.();
  }
  if (action === "ignore-stop") ignoreStop = true;
  if (action === "allow-stop") ignoreStop = false;
  if (action === "tick") {
    const t = codex.threads.get("alpha")!.turns.at(-1);
    codex.item(
      "alpha",
      t.id,
      {
        id: t.items.at(-1).id,
        type: "agentMessage",
        text: "Updated latest history answer",
      },
      true,
    );
  }
  return { turns, interrupts, pages, uploads };
});
await ctx.app.listen({ host: "127.0.0.1", port });
console.log("Conversation recovery UI fixture ready");
for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.once(
    sig,
    () =>
      void ctx.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
