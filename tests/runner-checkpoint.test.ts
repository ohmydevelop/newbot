import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ThreadCheckpoints } from "../server/runner/checkpoint.js";
async function fixture(work: (x: any) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "runner-checkpoint-")),
    home = join(root, "source", "native"),
    workspace = join(root, "source", "workspace"),
    threadId = randomUUID();
  await mkdir(join(home, "sessions"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  const rollout = join(home, "sessions", `rollout-${threadId}.jsonl`);
  await writeFile(
    rollout,
    JSON.stringify({ type: "session_meta", payload: { id: threadId } }) + "\n",
  );
  await writeFile(join(workspace, "file.txt"), "original");
  await writeFile(join(home, "auth.json"), "SHOULD_NOT_COPY");
  const store = new ThreadCheckpoints(join(root, "server"));
  const input = {
    threadId,
    home,
    workspace,
    rollout,
    nativeVersion: "native-sha-fixture",
    isStopped: () => true,
  };
  try {
    await work({ root, store, input });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("cold checkpoint restores a fresh node after the source is removed, excluding auth and databases", () =>
  fixture(async ({ root, store, input }) => {
    const m = await store.capture(input);
    await rm(join(root, "source"), { recursive: true });
    const result = await store.restore(
      m.id,
      input.nativeVersion,
      join(root, "fresh"),
    );
    assert.equal(result.manifest.threadId, input.threadId);
    assert.equal(
      await readFile(join(result.workspace, "file.txt"), "utf8"),
      "original",
    );
    assert.ok(
      !m.files.some(
        (f: any) => f.path.includes("auth") || f.path.includes("sqlite"),
      ),
    );
    await assert.rejects(
      store.restore(m.id, input.nativeVersion, join(root, "fresh")),
      /已存在/,
    );
    assert.equal(
      await readFile(join(result.workspace, "file.txt"), "utf8"),
      "original",
    );
  }));
test("running nodes cannot publish a cold checkpoint", () =>
  fixture(async ({ store, input }) => {
    await assert.rejects(
      store.capture({ ...input, isStopped: () => false }),
      /停止/,
    );
  }));
test("corrupt or mismatched-version checkpoint is rejected before publishing a target", () =>
  fixture(async ({ root, store, input }) => {
    const m = await store.capture(input);
    await assert.rejects(
      store.restore(m.id, "different", join(root, "bad")),
      /版本/,
    );
    await writeFile(join(store.root, m.id, "workspace/file.txt"), "tampered");
    await assert.rejects(
      store.restore(m.id, input.nativeVersion, join(root, "bad")),
      /校验/,
    );
    await assert.rejects(readFile(join(root, "bad", "workspace", "file.txt")));
  }));
test("workspace links cannot escape to host files", () =>
  fixture(async ({ store, input }) => {
    await symlink(
      join(input.home, "auth.json"),
      join(input.workspace, "secret"),
    );
    await assert.rejects(store.capture(input), /链接/);
  }));
test("manifest traversal and secret-native-file injection cannot write outside target", () =>
  fixture(async ({ root, store, input }) => {
    const m = await store.capture(input),
      p = join(store.root, m.id, "manifest.json");
    m.files[0].path = "../escape";
    await writeFile(p, JSON.stringify(m));
    await assert.rejects(
      store.restore(m.id, input.nativeVersion, join(root, "bad")),
      /路径/,
    );
    m.files[0].path = "native/auth.json";
    await writeFile(p, JSON.stringify(m));
    await assert.rejects(
      store.restore(m.id, input.nativeVersion, join(root, "bad")),
      /范围/,
    );
  }));
test("a replaced checkpoint directory cannot redirect import to another source", () =>
  fixture(async ({ root, store, input }) => {
    const m = await store.capture(input);
    await rm(join(store.root, m.id, "workspace"), { recursive: true });
    await symlink(input.workspace, join(store.root, m.id, "workspace"));
    await assert.rejects(
      store.restore(m.id, input.nativeVersion, join(root, "bad")),
      /链接/,
    );
  }));

test("lineage dependencies and mismatched native identity cannot be silently omitted", () =>
  fixture(async ({store,input}) => {
    for (const payload of [{id: randomUUID()}, {id: input.threadId,history_base:{thread_id:randomUUID()}}, {id:input.threadId,forked_from_id:randomUUID()}]) {
      await writeFile(input.rollout, JSON.stringify({type:"session_meta",payload})+"\n");
      await assert.rejects(store.capture(input), /身份|依赖/);
    }
  }));
test("empty workspace directories survive recovery and concurrent restores cannot overwrite a target", () =>
  fixture(async ({store,input,root}) => {
    await mkdir(join(input.workspace,"empty/deep"), {recursive:true});
    const m=await store.capture(input), target=join(root,"fresh");
    const results=await Promise.allSettled([store.restore(m.id,input.nativeVersion,target),store.restore(m.id,input.nativeVersion,target)]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    const {stat}=await import("node:fs/promises");
    assert.equal((await stat(join(target,"workspace/empty/deep"))).isDirectory(),true);
  }));
