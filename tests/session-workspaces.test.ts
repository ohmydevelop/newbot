import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { ConfigCodex } from "./config-fixture.js";
import { ProviderRuntime } from "../server/provider-runtime.js";

const origin = "http://127.0.0.1:3100";
async function auth(ctx: Awaited<ReturnType<typeof createServer>>) {
  const r = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "workspace-test-password" },
  });
  return { origin, cookie: r.headers["set-cookie"]!.toString().split(";")[0] };
}

test("new conversations isolate cwd, sandbox roots, live browsing and captured files; old threads retain their directory through restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-workspaces-")),
    cwd = join(dir, "workspace");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "old.md"), "old content");
  const db = database(dir);
  db.addThread("legacy", "fixture");
  db.raw.close();
  const codex = new FakeCodex();
  let ctx = await createServer({
    directory: dir,
    cwd,
    codex,
    providerRuntime: null,
    password: "workspace-test-password",
    origins: [origin],
  });
  try {
    let headers = await auth(ctx);
    const run = async (text: string) => {
      const r = await ctx.app.inject({
        method: "POST",
        url: "/api/agent/run",
        headers,
        payload: { mode: "work", text, requestId: randomUUID() },
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    const a = await run("a"),
      b = await run("b");
    const rootA = ctx.workspaces.root(a.threadId),
      rootB = ctx.workspaces.root(b.threadId);
    assert.notEqual(rootA, rootB);
    assert.notEqual(rootA, cwd);
    assert.equal(ctx.workspaces.root("legacy"), cwd);
    writeFileSync(join(rootA, "same.txt"), "A");
    writeFileSync(join(rootB, "same.txt"), "B");
    writeFileSync(join(rootA, "only-a.txt"), "private to A");
    const artA = await ctx.artifacts.register(
        a.threadId,
        a.turn.id,
        "same.txt",
      ),
      artB = await ctx.artifacts.register(b.threadId, b.turn.id, "same.txt");
    const get = (url: string) => ctx.app.inject({ url, headers });
    assert.equal((await get(artA.contentUrl)).body, "A");
    assert.equal((await get(artB.contentUrl)).body, "B");
    assert.equal((await get("/api/workspace/files")).statusCode, 400);
    assert.ok(
      !(await get("/api/workspace/files?threadId=" + b.threadId)).body.includes(
        "only-a",
      ),
    );
    assert.ok(
      (await get("/api/workspace/files?threadId=legacy")).body.includes(
        "old.md",
      ),
    );
    assert.equal(
      (
        await get(
          "/api/workspace/files?threadId=" +
            b.threadId +
            "&path=../" +
            a.threadId,
        )
      ).statusCode,
      400,
    );
    const starts = codex.calls.filter((c) => c.method === "thread/start");
    assert.equal(starts[0].params.cwd, rootA);
    assert.equal(starts[1].params.cwd, rootB);
    const turns = codex.calls.filter((c) => c.method === "turn/start");
    assert.deepEqual(turns[0].params.sandboxPolicy.writableRoots, [rootA]);
    assert.deepEqual(turns[1].params.sandboxPolicy.writableRoots, [rootB]);
    codex.finish(a.threadId);
    codex.finish(b.threadId);
    await ctx.app.close();
    ctx = await createServer({
      directory: dir,
      cwd,
      codex: new FakeCodex(),
      providerRuntime: null,
      password: "workspace-test-password",
      origins: [origin],
    });
    headers = await auth(ctx);
    assert.equal(ctx.workspaces.root(a.threadId), rootA);
    assert.equal(ctx.workspaces.root("legacy"), cwd);
    assert.equal(
      (await ctx.app.inject({ url: artB.contentUrl, headers })).body,
      "B",
    );
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

class ExtensionsCodex extends ConfigCodex {
  skillPath = "";
  failResume = false;
  unloads: string[] = [];
  override async unload(id: string) {
    this.loaded.delete(id);
    this.unloads.push(id);
  }
  override async call(method: any, params: any): Promise<any> {
    if(method==="thread/resume" && this.failResume){this.failResume=false;throw new Error("synthetic resume rejection");}
    if (method === "skills/list")
      return {
        data: [
          {
            cwd: params.cwds[0],
            errors: [],
            skills: [
              {
                name: "session-note",
                description: "test",
                path: this.skillPath,
                scope: "user",
                enabled: true,
              },
            ],
          },
        ],
      };
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
test("SQLite extension edits defer to the next turn, project skills are copied, disabled skills cannot be cited, and another active thread is untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-extensions-")),
    cwd = join(dir, "work"),
    codex = new ExtensionsCodex();
  codex.home = join(dir, "codex");
  const folder = join(codex.home, "skills", "session-note");
  mkdirSync(folder, { recursive: true });
  codex.skillPath = join(folder, "SKILL.md");
  writeFileSync(
    codex.skillPath,
    "---\nname: session-note\ndescription: test\n---\noriginal skill",
  );
  writeFileSync(join(folder, "helper.sh"), "echo helper");
  codex.config.mcp_servers = {
    alpha: { command: "node", args: ["fixture.js"], enabled: true },
  };
  codex.config.plugins = {};
  const providerRuntime = new ProviderRuntime({
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
  const ctx = await createServer({
    directory: dir,
    cwd,
    codex,
    providerRuntime,
    password: "workspace-test-password",
    origins: [origin],
  });
  try {
    const headers = await auth(ctx);
    const action = (url: string, payload: object) =>
      ctx.app.inject({ method: "POST", url, headers, payload });
    const run = async (payload: object) => {
      const r = await action("/api/agent/run", {
        requestId: randomUUID(),
        mode: "work",
        text: "use skills",
        ...payload,
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    const a = await run({});
    const snapshotA = ctx.workspaces.saved(a.threadId);
    const resource = snapshotA.snapshot.resources[0];
    assert.equal(
      readFileSync(resource.projectPath, "utf8"),
      readFileSync(codex.skillPath, "utf8"),
    );
    assert.equal(
      readFileSync(
        join(
          ctx.workspaces.root(a.threadId),
          ".agents",
          "skills",
          "newbot-" + resource.id,
          "helper.sh",
        ),
        "utf8",
      ),
      "echo helper",
    );
    const originalNative = codex.calls.find(
      (c) =>
        c.method === "thread/start" &&
        c.params.cwd === ctx.workspaces.root(a.threadId),
    )!;
    assert.equal(originalNative.params.config.mcp_servers.alpha.enabled, true);
    const config = (
      await ctx.app.inject({ url: "/api/config", headers })
    ).json().configuration;
    const toggle = await action("/api/config", {
      action: "mcp/enabled",
      id: "alpha",
      enabled: false,
      expectedRevision: config.revision,
    });
    assert.equal(toggle.statusCode, 200, toggle.body);
    assert.equal(ctx.workspaces.saved(a.threadId).revision, snapshotA.revision);
    assert.ok(!codex.unloads.includes(a.threadId));
    const b = await run({});
    assert.equal(
      ctx.workspaces.saved(b.threadId).snapshot.config.mcp_servers.alpha
        .enabled,
      false,
    );
    codex.finish(a.threadId);
    const next = await run({ threadId: a.threadId });
    assert.equal(next.threadId, a.threadId);
    assert.notEqual(
      ctx.workspaces.saved(a.threadId).revision,
      snapshotA.revision,
    );
    assert.ok(codex.unloads.includes(a.threadId));
    assert.ok(!codex.unloads.includes(b.threadId));
    assert.equal(
      codex.calls.filter(
        (c) =>
          c.method === "config/batchWrite" ||
          c.method === "skills/config/write",
      ).length,
      0,
    );
    assert.ok(
      (
        ctx.db.raw
          .prepare("SELECT content FROM extension_configuration")
          .get() as any
      ).content.includes("alpha"),
    );
    codex.finish(a.threadId);
    const beforeFailure=ctx.workspaces.saved(a.threadId),oldContent=readFileSync(beforeFailure.snapshot.resources[0].projectPath,"utf8");
    writeFileSync(codex.skillPath,"---\nname: session-note\ndescription: test\n---\nchanged skill");
    codex.failResume=true;
    const failed=await action("/api/agent/run",{requestId:randomUUID(),threadId:a.threadId,text:"failed sync"});
    assert.equal(failed.statusCode,400,failed.body);
    assert.equal(ctx.workspaces.saved(a.threadId).revision,beforeFailure.revision);
    assert.equal(readFileSync(beforeFailure.snapshot.resources[0].projectPath,"utf8"),oldContent);
    assert.ok(codex.active.has(b.threadId));
    await run({threadId:a.threadId});
    assert.ok(readFileSync(ctx.workspaces.saved(a.threadId).snapshot.resources[0].projectPath,"utf8").includes("changed skill"));
    const s = await action("/api/config", {
      action: "skills/config/write",
      path: codex.skillPath,
      enabled: false,
    });
    assert.equal(s.statusCode, 200, s.body);
    const skill = await ctx.service.skills.read(resource.id);
    assert.equal(skill.skill.enabled, false);
    await assert.rejects(
      ctx.service.skills.prepare([{ id: resource.id, sha256: skill.sha256 }]),
      /停用/,
    );
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
