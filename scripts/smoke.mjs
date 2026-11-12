// Optional live integration test. Sends one small prompt through the configured Provider.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const base = process.env.SMOKE_URL || "http://127.0.0.1:3100";
const password =
  process.env.SMOKE_PASSWORD ||
  readFileSync(".data/initial-password", "utf8").trim();
const login = await fetch(base + "/api/login", {
  method: "POST",
  headers: { origin: base, "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error("Smoke login failed");
const cookie = login.headers.get("set-cookie").split(";")[0];
const config = await (
  await fetch(base + "/api/config", { headers: { cookie } })
).json();
const model = config.models?.find((m) => m.isDefault) || config.models?.[0];
if (!model) throw new Error("No discovered models");
const controller = new AbortController();
const stream = await fetch(base + "/api/agent/events", {
  headers: { cookie },
  signal: controller.signal,
});
const reader = stream.body.getReader();
let buffer = "";
const types = [];
let finish;
const terminal = new Promise((resolve) => {
  finish = resolve;
});
const consuming = (async () => {
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        types.push(event.type);
        if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR")
          finish(event);
      }
    }
  } catch {}
})();
try {
  const response = await fetch(base + "/api/agent/run", {
    method: "POST",
    headers: { cookie, origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "只回复：newbot 已连接。不要调用任何工具。",
      model: model.model,
      effort: model.defaultReasoningEffort,
      requestId: randomUUID(),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  const timeout = setTimeout(() => finish({ type: "TIMEOUT" }), 45000);
  const event = await terminal;
  clearTimeout(timeout);
  const history = await (
    await fetch(`${base}/api/threads/${result.threadId}`, {
      headers: { cookie },
    })
  ).json();
  const text = history.turns
    ?.flatMap((t) => t.items)
    .filter((i) => i.type === "agentMessage")
    .map((i) => i.text)
    .join("\n");
  const report = {
    threadId: result.threadId,
    terminal: event.type,
    eventTypes: [...new Set(types)],
    responsePresent: !!text,
    historyStatus: history.turns?.at(-1)?.status,
  };
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(".data/smoke-result.json", JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
  if (event.type !== "RUN_FINISHED" || !text) process.exitCode = 1;
} finally {
  controller.abort();
  await consuming;
  await fetch(base + "/api/logout", {
    method: "POST",
    headers: { origin: base, cookie },
  });
}
