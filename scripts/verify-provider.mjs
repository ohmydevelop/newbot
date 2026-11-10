// This makes real model/tool calls. Run only against the dedicated acceptance instance.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { client } from "./ops-common.mjs";
const api = await client();
const providers = process.argv.slice(2);
if (!providers.length)
  throw new Error(
    "Usage: node scripts/verify-provider.mjs PROVIDER_ID [SECOND_PROVIDER_ID]",
  );
const report = { at: new Date().toISOString(), providers: [] };
for (const provider of providers) {
  const row = {
    provider,
    status: "failed",
    checks: {},
    manual: [
      "native approval",
      "image understanding",
      "explicit Skill",
      "MCP OAuth",
      "official MCP App",
    ],
  };
  report.providers.push(row);
  try {
    await api("/api/agent/action", { action: "provider/switch", provider });
    const config = await api("/api/config");
    const current = config.providers.find((p) => p.current)?.id;
    if (current !== provider) throw new Error("Provider mismatch");
    const model = config.models.find((m) => m.isDefault) || config.models[0];
    if (!model) throw new Error("No discovered model");
    row.model = model.model;
    let cursor,
      events = [];
    const initial = await api("/api/agent/events?transport=poll");
    cursor = initial.cursor;
    const start = await api("/api/agent/run", {
      text: "请调用命令工具执行 pwd，只执行这一个命令；然后用一句中文说明结果。不要写文件或访问网络。",
      model: model.model,
      effort: model.defaultReasoningEffort,
      requestId: randomUUID(),
    });
    const deadline = Date.now() + 180000;
    let history;
    while (Date.now() < deadline) {
      const batch = await api(
        "/api/agent/events?transport=poll&threadId=" +
          start.threadId +
          "&cursor=" +
          encodeURIComponent(cursor),
      );
      cursor = batch.cursor;
      events.push(...batch.events);
      history = await api("/api/threads/" + start.threadId);
      const approvals = await api("/api/agent/action", {
        action: "approval/list",
      });
      if (approvals.some((a) => a.params.threadId === start.threadId))
        throw new Error(
          "Approval pending: use trusted UI, then repeat verification",
        );
      if (
        history.turns.some(
          (t) =>
            t.id === start.turn.id &&
            ["completed", "failed", "interrupted"].includes(t.status),
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const turn = history?.turns.find((t) => t.id === start.turn.id);
    row.checks.completed = turn?.status === "completed";
    row.checks.tool =
      turn?.items.some(
        (i) => i.type === "commandExecution" && i.exitCode === 0,
      ) || false;
    row.checks.textStream = events.some(
      (e) => e.type === "TEXT_MESSAGE_CONTENT",
    );
    row.checks.reasoningParameter =
      !!model.defaultReasoningEffort && row.checks.completed;
    const restored = await api("/api/agent/action", {
      action: "thread/resume",
      threadId: start.threadId,
    });
    row.checks.historyRestore = restored.turns.some(
      (t) => t.id === start.turn.id,
    );
    row.checks.idempotent =
      (await api("/api/agent/runs/" + start.requestId)).turn?.id ===
      start.turn.id;
    row.status = Object.values(row.checks).every(Boolean) ? "passed" : "failed";
  } catch {
    row.error =
      "Verification failed; inspect authenticated UI without logging credentials or payloads";
  }
}
mkdirSync(".data", { recursive: true, mode: 0o700 });
writeFileSync(".data/provider-matrix.json", JSON.stringify(report, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
if (
  report.providers.length < 2 ||
  report.providers.some((p) => p.status !== "passed")
)
  process.exitCode = 1;
