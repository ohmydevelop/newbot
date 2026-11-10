// Opt-in one-turn native proof through the product HTTP API, using configured model access.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "../server/index.ts";
const directory = mkdtempSync(join(tmpdir(), "newbot-skill-run-live-"));
const cwd = join(directory, "workspace");
const folder = join(cwd, ".agents", "skills", "native-selection-proof");
const marker = `NATIVE_SKILL_PROOF_${randomBytes(8).toString("hex")}`;
mkdirSync(folder, { recursive: true });
writeFileSync(
  join(folder, "SKILL.md"),
  `---\nname: native-selection-proof\ndescription: Verify explicitly selected native skill input\n---\n# Native selection proof\n\nFor a proof request, reply with exactly this token: ${marker}\nDo not call tools, change files, use MCP, access external services or delegate work.\n`,
);
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
const origin = "http://127.0.0.1:3111",
  password = randomBytes(24).toString("base64url");
const ctx = await createServer({
    providerRuntime: null,
  directory: join(directory, "app"),
  cwd,
  password,
  origins: [origin],
});
const output = resolve(".data/skills-run-live");
mkdirSync(output, { recursive: true, mode: 0o700 });
let threadId, timer, model;
const inputs = [];
const call = ctx.runtime.call.bind(ctx.runtime);
ctx.runtime.call = async (method, params) => {
  if (method === "turn/start") inputs.push(params.input);
  return call(method, params);
};
ctx.runtime.on(
  "approval",
  (request) =>
    void ctx.service
      .handle("approval/respond", { id: request.id, allow: false })
      .catch(() => {}),
);
try {
  await ctx.app.listen({ host: "127.0.0.1", port: 3111 });
  await ctx.runtime.start();
  assert.equal(ctx.runtime.state, "ready", "Native runtime failed to start");
  const settings = await ctx.service.settings();
  model =
    settings.models.find((m) => m.model === settings.model)?.model ||
    settings.models.find((m) => m.isDefault)?.model ||
    settings.models[0]?.model;
  const login = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0],
    headers = { origin, cookie };
  const entry = settings.skills.find(
    (s) => s.name === "native-selection-proof",
  );
  assert.ok(entry, "Native project skill was not discovered");
  const doc = await (
    await fetch(`${origin}/api/skills/${entry.id}`, { headers })
  ).json();
  assert.ok(doc.sha256);
  const completed = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Native skill proof timed out")),
      150000,
    );
    ctx.runtime.on("event", (event) => {
      if (event.method === "turn/completed") resolve(event.params);
    });
  });
  completed.catch(() => {});
  const response = await fetch(`${origin}/api/agent/run`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(),
      text: "Follow the explicitly selected skill for this proof request. Reply with its proof token only. Do not use tools or modify files.",
      model,
      skills: [{ id: entry.id, sha256: doc.sha256 }],
    }),
  });
  assert.equal(
    response.status,
    200,
    "Product run endpoint rejected the native skill proof",
  );
  const run = await response.json();
  threadId = run.threadId;
  const end = await completed;
  assert.equal(end.threadId, threadId);
  assert.equal(
    end.turn.status,
    "completed",
    "Native skill task did not complete",
  );
  const thread = await ctx.service.read(threadId);
  const text = thread.turns
    .flatMap((turn) => turn.items)
    .filter((i) => i.type === "agentMessage")
    .map((i) => i.text || "")
    .join("\n");
  assert.ok(
    text.includes(marker),
    "Native response did not contain the token that exists only in SKILL.md",
  );
  assert.deepEqual(
    inputs[0].filter((i) => i.type === "skill"),
    [{ type: "skill", name: entry.name, path: entry.path }],
  );
  const ref = thread.turns[0].items.find((i) => i.type === "userMessage")
    .skillRefs[0];
  assert.equal(ref.sha256, doc.sha256);
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        model,
        nativeSkillInputs: 1,
        proofTokenMatched: true,
        referenceHashMatched: true,
        turnStatus: end.turn.status,
        noApprovedTools: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `Native structured skill task passed (${model}); proof token and message reference verified.`,
  );
} catch (error) {
  writeFileSync(
    join(output, "failure.json"),
    JSON.stringify(
      { error: String(error), model, runtime: ctx.runtime.state },
      null,
      2,
    ),
  );
  throw error;
} finally {
  clearTimeout(timer);
  if (threadId) {
    if (ctx.runtime.active.has(threadId)) {
      const turn = ctx.service.events.threads.get(threadId)?.turns.at(-1);
      if (turn)
        await ctx.service
          .handle("turn/interrupt", { threadId, turnId: turn.id })
          .catch(() => {});
    }
    if (!ctx.runtime.active.has(threadId))
      await ctx.service.handle("thread/archive", { threadId }).catch(() => {});
  }
  await ctx.app.close();
  rmSync(directory, { recursive: true, force: true });
}
