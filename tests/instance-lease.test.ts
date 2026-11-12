import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { instanceLease } from "../server/instance-lease.js";

test("migration cannot overlap a writer and requires a clean shutdown, not merely an absent process", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-lease-"));
  try {
    await assert.rejects(instanceLease(root, "migration"), /正常停止/);
    const a = await instanceLease(root);
    await assert.rejects(instanceLease(root), /仍在运行/);
    await assert.rejects(instanceLease(root, "migration"), /仍在运行/);
    await a.release(false);
    await assert.rejects(instanceLease(root, "migration"), /正常停止/);
    const b = await instanceLease(root);
    await b.release(true);
    const before = await readFile(join(root, ".instance-state.json"), "utf8");
    const migration = await instanceLease(root, "migration");
    await assert.rejects(instanceLease(root), /仍在运行/);
    await migration.release();
    assert.equal(
      await readFile(join(root, ".instance-state.json"), "utf8"),
      before,
    );
    const c = await instanceLease(root);
    await c.release(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a crashed process releases the kernel lock but does not make its files eligible for migration", async () => {
  const { spawn } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "newbot-crash-"));
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {instanceLease} from './server/instance-lease.ts';await instanceLease(${JSON.stringify(root)});console.log('ready');setInterval(()=>{},1000);`,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await new Promise<void>((ok, fail) => {
      const timeout = setTimeout(
        () => fail(Error("lease child startup timeout")),
        5000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timeout);
        ok();
      });
      child.once("error", fail);
    });
    await assert.rejects(instanceLease(root), /仍在运行/);
    await new Promise<void>((ok) => {
      child.once("exit", () => ok());
      child.kill("SIGKILL");
    });
    await assert.rejects(instanceLease(root, "migration"), /正常停止/);
    const restarted = await instanceLease(root);
    await restarted.release(true);
    const migration = await instanceLease(root, "migration");
    await migration.release();
  } finally {
    child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});

test("independent Runner cannot auto-restart after an unclean exit marker, while ordinary Server recovery is unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runner-unclean-"));
  try {
    const lease = await instanceLease(dir, "runner");
    await lease.release(false);
    await assert.rejects(instanceLease(dir, "runner"), /未正常停止/);
    const ordinary = await instanceLease(dir);
    await ordinary.release(true);
    const clean = await instanceLease(dir, "runner");
    await clean.release(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
