import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { A2uiFixtureCodex, formMessages } from "./a2ui-fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-a2ui-ui-"));
const port = Number(process.env.A2UI_CHAT_TEST_PORT || 3124),
  origin = `http://127.0.0.1:${port}`;
let latest: { threadId: string; turnId: string } | null = null;
async function boot(history?: A2uiFixtureCodex["threads"]) {
  const codex = new A2uiFixtureCodex();
  if (history) {
    codex.threads = history;
    for (const t of history.values())
      for (const turn of t.turns) turn.status = "interrupted";
  }
  const ctx = await createServer({
  webDirectory: process.env.UI_TEST_CANDIDATE,
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    password: "a2ui-chat-test-password",
    codex,
    origins: [origin],
  });
  const call = codex.call.bind(codex);
  codex.call = (async (method: any, params: any) => {
    const result: any = await call(method, params);
    if (method === "turn/start") {
      latest = { threadId: params.threadId, turnId: result.turn.id };
      const current = latest;
      setTimeout(() => {
        codex.tool(current.threadId, current.turnId, {
          messages: formMessages(),
          waitForAction: false,
        });
        codex.tool(current.threadId, current.turnId, {
          messages: [
            {
              version: "v0.9",
              updateDataModel: {
                surfaceId: "monitor-demo",
                path: "/status",
                value: "请选择任务参数，然后提交。",
              },
            },
          ],
          waitForAction: true,
        });
      }, 50);
    }
    return result;
  }) as typeof codex.call;
  const respond = codex.respondTool.bind(codex);
  codex.respondTool = (id, result) => {
    const request = codex.toolRequests.get(id)!;
    respond(id, result);
    const text = result.contentItems.find((item) => item.type === "inputText");
    if (!text || text.type !== "inputText") return;
    let action: any;
    try {
      action = JSON.parse(text.text);
    } catch {
      return;
    }
    if (action.version !== "v0.9" || !action.action) return;
    setTimeout(() => {
      const { threadId, turnId } = request.params;
      const text =
        action.action.name === "cancel"
          ? "已取消本次填写。"
          : `已收到任务：${action.action.context.name}，服务器：${action.action.context.server?.join("、")}。`;
      codex.item(
        threadId,
        turnId,
        { id: "fixture-a2ui-result", type: "agentMessage", text },
        true,
      );
      codex.finish(threadId);
    }, 50);
  };
  ctx.app.post("/api/test/a2ui", async (req) => {
    const body = req.body as { action: string };
    if (body.action === "offline") codex.offline("fixture offline");
    if (body.action === "interrupt" && latest)
      codex.finish(latest.threadId, "interrupted");
    if (body.action.startsWith("restart")) {
      if (body.action === "restart-invalid" && latest)
        ctx.db.raw
          .prepare(
            "UPDATE a2ui_views SET snapshot='invalid' WHERE thread_id=? AND turn_id=?",
          )
          .run(latest.threadId, latest.turnId);
      const history = structuredClone(codex.threads);
      setTimeout(
        () =>
          void (async () => {
            await ctx.app.close();
            current = await boot(history);
          })(),
        50,
      );
      return { restarting: true };
    }
    return {
      pending: ctx.service.ui.pending,
      responses: codex.toolResponses.map(({ response }) => response),
    };
  });
  await ctx.app.listen({ host: "127.0.0.1", port });
  console.log(`A2UI chat fixture ready: ${origin}`);
  return ctx;
}
let current = await boot();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void current.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
