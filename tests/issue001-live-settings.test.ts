import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../server/db.js";
import { sessionRuntime } from "../server/session-runtime.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { FakeCodex } from "./fixture.js";
import { PublicError } from "../server/public-error.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "issue001-live-settings-")),
    db = database(directory),
    native = new FakeCodex();
  db.addThread("thread", "a");
  native.active.add("thread");
  native.activeTurns.set("thread", "turn");
  native.runtimeCapabilities = { liveModelRoutes: true };
  const providers = new ProviderRuntime({
    model_provider: "a",
    model: "fixture-model",
    model_providers: {
      a: { name: "A", base_url: "https://a.example/v1", wire_api: "responses" },
      b: { name: "B", base_url: "https://b.example/v1", wire_api: "responses" },
    },
  });
  native.providerRuntime = providers;
  const config = {
    runtime: providers,
    read: async () => ({
      response: { config: providers.snapshot().values },
      publicView: {
        revision: providers.revision,
        defaults: { provider: "a", model: "fixture-model" },
        providers: ["a", "b"].map((id) => ({
          id,
          name: id,
          endpointOrigin: `https://${id}.example`,
          wireApi: "responses",
        })),
      },
    }),
  };
  const model = {
    id: "fixture-model",
    model: "fixture-model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "medium" },
      { reasoningEffort: "high" },
    ],
  };
  const runtime = sessionRuntime(
    native,
    db,
    directory,
    config as any,
    { probe: async () => ({ models: ["fixture-model"] }) } as any,
    async () => [model],
  );
  runtime.adopt("thread", {
    model: "fixture-model",
    modelProvider: "a",
    reasoningEffort: "medium",
  });
  const original = native.call.bind(native);
  let requests: any[] = [];
  let dispatch: (p: any) => Promise<any> = async () => ({ status: "applied" });
  native.call = async (method, p: any) => {
    if (method === "turn/settings/update") {
      requests.push(p);
      return dispatch(p);
    }
    return original(method, p);
  };
  const update = (patch: any) =>
    runtime.update(
      {
        threadId: "thread",
        expectedRevision: runtime.get("thread").revision,
        ...patch,
      },
      true,
    );
  const used = (revision: number, providerId: string) =>
    native.emit("event", {
      method: "turn/settings/applied",
      params: {
        threadId: "thread",
        turnId: "turn",
        revision,
        providerId,
        model: "fixture-model",
        effort: "medium",
      },
    });
  return {
    db,
    native,
    providers,
    runtime,
    requests,
    update,
    used,
    setDispatch: (fn: typeof dispatch) => {
      dispatch = fn;
    },
    close: async () => {
      db.raw.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("acceptance does not claim adoption; late revisions cannot overwrite newer choices and rejected updates restore prior intent", async () => {
  const f = await fixture();
  try {
    const first = await f.update({ provider: "b" });
    assert.equal(first.pending?.state, "accepted");
    assert.equal(first.applied?.provider, "a");
    const second = await f.update({ provider: "a", effort: "high" });
    f.used(first.revision, "b");
    assert.equal(f.runtime.get("thread").provider, "a");
    assert.equal(f.runtime.get("thread").applied?.provider, "b");
    f.used(second.revision, "a");
    f.used(first.revision, "b");
    assert.equal(f.runtime.get("thread").applied?.revision, second.revision);
    f.setDispatch(async () => {
      throw new PublicError("unsupported destination");
    });
    await assert.rejects(f.update({ provider: "b" }), /unsupported/);
    assert.equal(f.runtime.get("thread").provider, "a");
    assert.equal(f.runtime.get("thread").pending, undefined);
    f.setDispatch(async () => ({ status: "applied" }));
    const next = await f.update({ provider: "b" });
    assert.ok(
      next.revision > second.revision + 1,
      "rejected revisions are never reused",
    );
    f.setDispatch(async () => {
      throw new PublicError("rejected");
    });
    await assert.rejects(f.update({ provider: "a" }));
    assert.equal(f.runtime.get("thread").revision, next.revision);
    assert.equal(f.runtime.get("thread").pending?.state, "accepted");
  } finally {
    await f.close();
  }
});

test("a configuration change during private hydration or a completed target prevents native dispatch", async () => {
  const f = await fixture();
  try {
    let release!: (p: any) => void;
    let hydrated: any;
    f.native.privateConfiguration = (p) =>
      new Promise((resolve) => {
        hydrated = p;
        release = resolve;
      });
    const update = f.update({ provider: "b" });
    while (!release) await new Promise((r) => setImmediate(r));
    f.providers.apply(f.providers.revision, [
      {
        keyPath: "model_providers.b.base_url",
        value: "https://changed.example/v1",
        mergeStrategy: "replace",
      },
    ]);
    release(hydrated);
    await assert.rejects(update, /已变化/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.runtime.get("thread").provider, "a");
    release = undefined as any;
    const later = f.update({ provider: "b" });
    while (!release) await new Promise((r) => setImmediate(r));
    f.native.activeTurns.delete("thread");
    f.native.active.delete("thread");
    release(hydrated);
    await later;
    assert.equal(f.requests.length, 0);
    assert.equal(f.runtime.get("thread").pending?.state, "pending");
  } finally {
    await f.close();
  }
});

test("a lost native response stays unknown until actual-use evidence arrives; another thread cannot acknowledge it", async () => {
  const f = await fixture();
  try {
    f.setDispatch(async () => {
      throw new Error("transport closed");
    });
    await assert.rejects(f.update({ provider: "b" }));
    const waiting = f.runtime.get("thread");
    assert.equal(waiting.pending?.state, "unknown");
    assert.equal(waiting.applied?.provider, "a");
    f.native.emit("event", {
      method: "turn/settings/applied",
      params: {
        threadId: "other",
        turnId: "turn",
        revision: waiting.revision,
        providerId: "b",
        model: "fixture-model",
      },
    });
    assert.equal(f.runtime.get("thread").pending?.state, "unknown");
    f.used(waiting.revision, "b");
    assert.equal(f.runtime.get("thread").pending, undefined);
    assert.equal(f.runtime.get("thread").provider, "b");
  } finally {
    await f.close();
  }
});

test("a managed-policy change during queued live validation restores the preceding selection", async () => {
  const f = await fixture();
  try {
    const call = f.native.call.bind(f.native);
    let validations = 0;
    f.native.call = async (method, params) => {
      if (method === "configRequirements/read" && ++validations === 2)
        return { requirements: { allowedApprovalPolicies: ["never"] } } as any;
      return call(method, params);
    };
    await assert.rejects(f.update({ provider: "b" }), /运行策略不允许/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.runtime.get("thread").provider, "a");
    assert.equal(f.runtime.get("thread").pending, undefined);
  } finally {
    await f.close();
  }
});
