import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { ProviderRuntime } from "../server/provider-runtime.js";

test("a clean standard installation persists Server state and session workspaces across restart without creating repository .data", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-standard-")),
    previous = process.cwd();
  const keys = [
    "DATA_DIR",
    "NEWBOT_HOME",
    "NEWBOT_WORKSPACES_HOME",
    "NEWBOT_CODEX_HOME",
    "AGENT_WORKSPACE",
  ] as const;
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    process.chdir(root);
    for (const key of keys) delete process.env[key];
    process.env.NEWBOT_HOME = join(root, "global");
    process.env.NEWBOT_WORKSPACES_HOME = join(root, "Newbot/workspaces");
    const options = {
      password: "test-password-for-standard",
      codex: new FakeCodex(),
      providerRuntime: new ProviderRuntime(),
      origins: ["http://127.0.0.1:3100"],
    };
    server = await createServer(options);
    assert.equal(server.db.directory, join(root, "global/server"));
    const workspace = server.workspaces.allocate();
    server.db.addThread("saved-original-thread", "fixture");
    server.workspaces.bind("saved-original-thread", workspace);
    server.db.set("test:setting", "persisted");
    await assert.rejects(
      createServer({ ...options, codex: new FakeCodex() }),
      /仍在运行/,
    );
    await server.app.close();
    server = undefined;
    server = await createServer({ ...options, codex: new FakeCodex() });
    assert.equal(server.db.get("test:setting"), "persisted");
    assert.equal(
      server.workspaces.root("saved-original-thread"),
      workspace.root,
    );
    assert.equal(workspace.root, join(root, "Newbot/workspaces", workspace.id));
    await assert.rejects(readFile(join(root, ".data/newbot.sqlite")));
  } finally {
    await server?.app.close();
    process.chdir(previous);
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
