import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { PublicError } from "../server/public-error.js";
import { liveSettingsError } from "../server/codex.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-gateway-errors-"));
const codex = new FakeCodex();
let starts = 0;
const call = codex.call.bind(codex);
codex.call = (async (method: any, params: any) => {
  const r: any = await call(method, params);
  if (method === "model/list")
    r.data.push({
      ...r.data[0],
      id: "another-model",
      model: "another-model",
      displayName: "另一个测试模型",
      isDefault: false,
    });
  if (method === "turn/start") {
    starts++;
    const input = String(
      params.input.find((x: any) => x.type === "text")?.text || "",
    );
    const error = {
      message: input.includes("限流")
        ? "Too Many Requests"
        : "insufficient_balance; Authorization: Bearer DO_NOT_LEAK; https://private.invalid",
      codexErrorInfo: {
        httpConnectionFailed: {
          httpStatusCode: input.includes("限流") ? 429 : 403,
        },
      },
      additionalDetails: null,
    };
    setTimeout(() => {
      codex.emit("event", {
        method: "error",
        params: {
          threadId: params.threadId,
          turnId: r.turn.id,
          error,
          willRetry: input.includes("重试"),
        },
      });
      if (!input.includes("重试")) {
        codex.threads.get(params.threadId)!.turns.at(-1).error = error;
        codex.finish(params.threadId, "failed");
      }
    }, 100);
  }
  return r;
}) as typeof codex.call;
const { app, service } = await createServer({
  codex,
  providerRuntime: null,
  directory,
  cwd: join(directory, "work"),
  webDirectory: process.env.UI_TEST_CANDIDATE,
  password: "gateway-errors-fixture",
  origins: ["http://127.0.0.1:3153"],
});
const handle = service.handle.bind(service);
service.handle = (async (method: any, params: any) => {
  if (method === "session/update" && codex.active.has(params.threadId))
    throw new PublicError(
      liveSettingsError("the active model has only fallback metadata"),
    );
  return handle(method, params);
}) as typeof service.handle;
app.get("/api/test/count", async () => ({ starts }));
await app.listen({ host: "127.0.0.1", port: 3153 });
console.log("gateway error fixture ready");
process.once(
  "SIGTERM",
  () =>
    void app.close().then(() => {
      rmSync(directory, { recursive: true, force: true });
      process.exit(0);
    }),
);
