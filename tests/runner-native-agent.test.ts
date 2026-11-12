import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { RunnerLedger } from "../server/runner/ledger.js";
import { NativeRunnerAgent } from "../server/runner/native-agent.js";

test("stop during slow native startup waits for startup and terminates the late process before confirming stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runner-startup-race-")),
    ledger = new RunnerLedger(join(dir, "state"), randomUUID()),
    agent = new NativeRunnerAgent(
      ledger,
      join(dir, "codex"),
      join(dir, "workspaces"),
      "unused",
    );
  let enter!: () => void,
    release!: () => void,
    alive = false,
    stopped = false;
  const entered = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((r) => (release = r));
  agent.codex.start = async () => {
    enter();
    await gate;
    alive = true;
    agent.codex.state = "ready";
  };
  agent.codex.stop = () => {
    alive = false;
  };
  agent.codex.stopAndWait = async () => {
    alive = false;
  };
  try {
    const starting = agent.start();
    const failed = assert.rejects(starting, /停止/);
    await entered;
    const stopping = agent.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(stopped, false);
    release();
    await failed;
    await stopping;
    assert.equal(alive, false);
    assert.equal(stopped, true);
    await agent.stop();
  } finally {
    await agent.stop();
    ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});
