import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { ConfigCodex } from "./config-fixture.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { ComposerDrafts } from "../web/composer-drafts.js";
import { reduceAgentEvent } from "../shared/events.js";
import { mergeRecentHistory } from "../shared/history.js";
import { EventType } from "@ag-ui/core";
class ExpertCodex extends ConfigCodex {
  skillPath = "";
  skillExists = true;
  override async unload(id: string) {
    this.loaded.delete(id);
  }
  override async call(method: any, params: any): Promise<any> {
    if (method === "skills/list")
      return {
        data: [
          {
            cwd: params.cwds[0],
            errors: [],
            skills: this.skillExists
              ? [
                  {
                    name: "expert-note",
                    path: this.skillPath,
                    scope: "user",
                    enabled: true,
                    description: "Expert skill",
                  },
                ]
              : [],
          },
        ],
      };
    const summary = {
      id: "expert-plugin@local",
      name: "expert-plugin",
      installed: true,
      enabled: true,
      availability: "AVAILABLE",
      installPolicy: "AVAILABLE",
      interface: { displayName: "Expert plugin" },
    };
    if (method === "plugin/list")
      return {
        marketplaces: [
          {
            name: "local",
            path: "/fixture/marketplace.json",
            plugins: [summary],
          },
        ],
        marketplaceLoadErrors: [],
      };
    if (method === "plugin/read")
      return { plugin: { summary, skills: [], mcpServers: [] } };
    if (method === "configRequirements/read") return { requirements: null };
    const result: any = await super.call(method, params);
    if (
      (method === "thread/start" || method === "thread/resume") &&
      result.thread?.id &&
      this.providerRuntime
    )
      this.threadConfigRevisions.set(
        result.thread.id,
        this.providerRuntime.revision,
      );
    return result;
  }
}
test("expert bundles become native inputs, persist per chat, deduplicate references and respect disabled/deleted dependencies and revisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-experts-")),
    cwd = join(dir, "work"),
    codex = new ExpertCodex(),
    origin = "http://127.0.0.1:3100";
  codex.home = join(dir, "codex");
  codex.skillPath = join(codex.home, "skills", "expert-note", "SKILL.md");
  mkdirSync(join(codex.home, "skills", "expert-note"), { recursive: true });
  writeFileSync(
    codex.skillPath,
    "---\nname: expert-note\ndescription: Test expertise.\n---\nEXPERT_INPUT_PROOF",
  );
  codex.config = {
    model: "fixture-model",
    model_provider: "fixture",
    mcp_servers: { "test-server": { command: "node", enabled: true } },
  };
  const runtime = new ProviderRuntime({
    model_provider: "fixture",
    model: "fixture-model",
    model_providers: {
      fixture: {
        name: "Fixture",
        base_url: "https://example.com",
        wire_api: "responses",
        requires_openai_auth: true,
      },
    },
  });
  const options = {
    directory: dir,
    cwd,
    codex,
    providerRuntime: runtime,
    password: "expert-test-password",
    origins: [origin],
  };
  let ctx = await createServer(options),
    headers: any;
  const login = async () => {
    const r = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "expert-test-password" },
    });
    headers = {
      origin,
      cookie: r.headers["set-cookie"]!.toString().split(";")[0],
    };
  };
  const post = (url: string, payload: any) =>
    ctx.app.inject({ method: "POST", url, headers, payload });
  const action = (action: string, payload: any = {}) =>
    action === "thread/read"
      ? ctx.app.inject({ url: "/api/threads/" + payload.threadId, headers })
      : post("/api/agent/action", { action, ...payload });
  const ok = async (p: ReturnType<typeof post>) => {
    const r = await p;
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const run = (extra: any = {}) =>
    post("/api/agent/run", {
      requestId: randomUUID(),
      text: "Use expert",
      ...extra,
    });
  try {
    await login();
    const catalog = await ok(action("expert/list")),
      skillId = catalog.catalog.skills[0].id;
    const fields = {
      name: "Review expert",
      description: "Review and measure",
      skillIds: [skillId],
      pluginIds: ["expert-plugin@local"],
      connectorIds: ["test-server"],
    };
    const e = await ok(action("expert/save", fields));
    assert.ok(e.available);
    const document = await ctx.service.skills.read(skillId),
      requestId = randomUUID();
    const a = await ok(
      run({
        requestId,
        expertId: e.id,
        skills: [{ id: skillId, sha256: document.sha256 }],
        plugins: fields.pluginIds,
      }),
    );
    const input = codex.calls.filter((c) => c.method === "turn/start").at(-1)!
      .params.input;
    assert.equal(input.filter((i: any) => i.type === "skill").length, 1);
    assert.equal(input.filter((i: any) => i.type === "mention").length, 1);
    assert.match(
      input.find((i: any) => i.type === "skill").path,
      /workspaces\/.*\.agents\/skills\/newbot-/,
    );
    assert.ok(input.some((i: any) => i.text?.includes("test-server")));
    assert.equal(
      (await ok(action("thread/read", { threadId: a.threadId }))).extensions
        .expertId,
      e.id,
    );
    const nextBinding = await ok(
      action("session/extensions", {
        threadId: a.threadId,
        expectedRevision: 0,
        expertId: null,
      }),
    );
    assert.equal(nextBinding.revision, 1);
    // This changes the next turn only. Restore the binding to exercise the rest
    // of the existing bundle lifecycle on the same native conversation.
    await ok(
      action("session/extensions", {
        threadId: a.threadId,
        expectedRevision: 1,
        expertId: e.id,
      }),
    );
    codex.finish(a.threadId);
    const history = await ok(action("thread/read", { threadId: a.threadId }));
    assert.equal(
      history.turns[0].items.find((i: any) => i.type === "userMessage").expert
        .id,
      e.id,
    );
    const count = codex.calls.filter((c) => c.method === "turn/start").length;
    await ok(
      run({
        requestId,
        expertId: e.id,
        skills: [{ id: skillId, sha256: document.sha256 }],
        plugins: fields.pluginIds,
      }),
    );
    assert.equal(
      codex.calls.filter((c) => c.method === "turn/start").length,
      count,
    );
    const b = await ok(run());
    codex.finish(b.threadId);
    assert.equal(
      (await ok(action("thread/read", { threadId: b.threadId }))).extensions
        .expertId,
      null,
    );
    let config = (await ctx.app.inject({ url: "/api/config", headers })).json()
      .configuration;
    await ok(
      action("plugin/enabled", {
        id: fields.pluginIds[0],
        enabled: false,
        expectedRevision: config.revision,
      }),
    );
    const blocked = await run({ threadId: a.threadId });
    assert.notEqual(blocked.statusCode, 200);
    assert.match(blocked.body, /不可用/);
    assert.equal(
      codex.calls.filter((c) => c.method === "turn/start").length,
      count + 1,
    );
    const unavailable = await ok(action("expert/read", { id: e.id }));
    assert.equal(unavailable.available, false);
    config = (await ctx.app.inject({ url: "/api/config", headers })).json()
      .configuration;
    await ok(
      action("plugin/enabled", {
        id: fields.pluginIds[0],
        enabled: true,
        expectedRevision: config.revision,
      }),
    );
    const updated = await ok(
      action("expert/save", {
        ...fields,
        id: e.id,
        expectedRevision: e.revision,
        name: "Updated expert",
      }),
    );
    assert.notEqual(
      (
        await action("expert/save", {
          ...fields,
          id: e.id,
          expectedRevision: e.revision,
        })
      ).statusCode,
      200,
    );
    await ok(run({ threadId: a.threadId }));
    codex.finish(a.threadId);
    assert.equal(
      (await ok(action("thread/read", { threadId: a.threadId }))).turns
        .at(-1)
        .items.find((i: any) => i.type === "userMessage").expert.revision,
      updated.revision,
    );
    await ctx.app.close();
    ctx = await createServer(options);
    await login();
    assert.equal(
      (await ok(action("thread/read", { threadId: a.threadId }))).extensions
        .expert.name,
      "Updated expert",
    );
    codex.skillExists = false;
    assert.notEqual((await run({ threadId: a.threadId })).statusCode, 200);
    assert.equal(
      (await ok(action("expert/read", { id: e.id }))).available,
      false,
    );
    await ok(
      action("expert/delete", { id: e.id, expectedRevision: updated.revision }),
    );
    assert.equal(
      (await ok(action("thread/read", { threadId: a.threadId }))).extensions
        .missing,
      true,
    );
    assert.notEqual((await run({ threadId: a.threadId })).statusCode, 200);
    const removed = await ok(
      action("session/extensions", {
        threadId: a.threadId,
        expectedRevision: 2,
        expertId: null,
      }),
    );
    assert.equal(removed.revision, 3);
    assert.notEqual(
      (
        await run({
          threadId: a.threadId,
          expertId: e.id,
          extensionRevision: 0,
        })
      ).statusCode,
      200,
    );
    await ok(
      run({ threadId: a.threadId, expertId: null, extensionRevision: 3 }),
    );
    codex.finish(a.threadId);
    assert.equal(
      codex.calls.filter((c) => c.method === "config/batchWrite").length,
      0,
    );
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("expert draft changes survive delayed acknowledgement; session events and older reads cannot replace newer bindings", () => {
  const drafts = new ComposerDrafts(),
    a = { id: randomUUID(), name: "A", revision: 1 },
    b = { id: randomUUID(), name: "B", revision: 1 };
  drafts.setExpert("$new", a);
  drafts.setText("$new", "run");
  const sent = drafts.get("$new");
  drafts.setExpert("$new", b);
  drafts.acknowledge(sent);
  assert.equal(drafts.get("$new").expert?.id, b.id);
  const snapshot = drafts.get("$new");
  drafts.acknowledge(snapshot, "thread");
  assert.equal(drafts.get("$new").expert, null);
  assert.equal(drafts.get("thread").expert, null);
  const thread = {
    id: "thread",
    turns: [],
    extensions: { revision: 2, expertId: b.id, expert: b, missing: false },
  };
  const stale = {
    ...thread,
    extensions: { revision: 1, expertId: a.id, expert: a, missing: false },
  };
  assert.equal(mergeRecentHistory(thread, stale).extensions?.expertId, b.id);
  assert.equal(
    reduceAgentEvent(thread, {
      type: EventType.CUSTOM,
      name: "newbot.session.extensions",
      value: { threadId: "thread", extensions: stale.extensions },
    }).extensions?.expertId,
    b.id,
  );
});
