import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { inputSchema } from "../examples/test-elicitation/schema.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-input-ui-")),
  codex = new FakeCodex(),
  port = Number(process.env.INPUT_TEST_PORT || 3121),
  replies: any[] = [];
let threadId = "",
  next = 100,
  current = 0;
const { app, service } = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "work"),
  codex,
  password: "input-ui-password",
  origins: [`http://127.0.0.1:${port}`],
});
(codex as any).send = (message: any) => {
  replies.push(message);
  if (codex.active.has(threadId)) setTimeout(() => codex.finish(threadId), 10);
};
function put(mode = "new") {
  const schema =
    mode === "sensitive"
      ? {
          type: "object",
          properties: {
            password: { type: "string", default: "SYNTHETIC_PRIVATE_DEFAULT" },
          },
        }
      : mode === "unsupported"
        ? {
            type: "object",
            properties: { data: { type: "object", properties: {} } },
          }
        : inputSchema;
  const id = mode === "reuse" ? current : ++next;
  current = id;
  const a = {
    id,
    method: "mcpServer/elicitation/request",
    params: {
      threadId,
      turnId: null,
      serverName: "input-test",
      mode: mode === "url" ? "url" : "form",
      message:
        mode === "reuse"
          ? "请求已更新，请重新填写。"
          : "填写模拟监控配置；不会创建真实任务。",
      requestedSchema: schema,
      _meta: { note: "SYNTHETIC_PRIVATE_META" },
      ...(mode === "url"
        ? { url: "https://forbidden.invalid/SYNTHETIC_PRIVATE_URL" }
        : {}),
    },
  };
  codex.approvals.set(id, a as any);
  codex.emit("approval", a);
  if (mode === "timeout") {
    service.elicitation.pending.get(id)!.expiresAt = Date.now() + 1200;
    service.events.approval(service.elicitation.publicApproval(a));
  }
}
const original = codex.call.bind(codex);
codex.call = (async (method: any, params: any) => {
  const result: any = await original(method, params);
  if (method === "turn/start") {
    threadId = params.threadId;
    setTimeout(() => put(), 100);
  }
  return result;
}) as typeof codex.call;
app.post("/api/test/input", async (req) => {
  const action = (req.body as any).action;
  if (
    ["new", "reuse", "sensitive", "unsupported", "url", "timeout"].includes(
      action,
    )
  )
    put(action);
  else if (action === "expire") {
    service.elicitation.pending.get(current)!.expiresAt = Date.now() - 1;
    service.elicitation.expire();
  } else if (action === "resolve") {
    codex.approvals.delete(current);
    codex.emit("resolved", current);
  } else if (action === "offline") codex.offline("测试运行时断开");
  else if (action === "ready") await codex.start();
  else throw Error("Unknown input fixture action");
  return { ok: true };
});
app.get("/api/test/input-state", async () => ({
  replies,
  pending: service.elicitation.list(),
  modelCalls: codex.calls.filter((c) => c.method === "turn/start").length,
  threadId,
}));
await app.listen({ host: "127.0.0.1", port });
console.log("Elicitation UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
