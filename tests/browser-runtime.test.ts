import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ComposerDrafts } from "../web/composer-drafts.js";
import { resourceLoadFailure } from "../web/resource-errors.js";
import { retainedAssets, safeAssetPaths } from "../shared/web-assets.js";
const prior = new Map(
  ["window", "localStorage", "sessionStorage", "fetch", "EventSource"].map(
    (k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)],
  ),
);
const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
};
const storage = memory();
class Source {
  static all: Source[] = [];
  onopen?: () => void;
  onmessage?: (m: { data: string }) => void;
  onerror?: () => void;
  closed = false;
  constructor(readonly url: string) {
    Source.all.push(this);
  }
  close() {
    this.closed = true;
  }
}
Object.assign(globalThis, {
  window: { innerWidth: 1280 },
  localStorage: storage,
  sessionStorage: memory(),
  EventSource: Source,
});
const {
  useApp,
  connect,
  disconnect,
  loadThreads,
  loadThread,
  loadSettings,
  request,
  consume,
} = await import("../web/store.js");
after(() => {
  disconnect();
  for (const [k, v] of prior)
    if (v) Object.defineProperty(globalThis, k, v);
    else Reflect.deleteProperty(globalThis, k);
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const cap = (transport = "sse") => ({
  webTransport: transport,
  capabilities: { runRecovery: { abandonUnseen: true } },
});
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 1000; i++) {
    if (fn()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw Error("Async condition not reached");
};
function reset() {
  disconnect();
  Source.all = [];
  useApp.setState({
    authenticated: true,
    selectedId: null,
    thread: null,
    settings: null,
    threads: [],
    approvals: [],
    abandonUnseen: false,
    runtime: "ready",
    error: "",
  });
}
test("resource failures select explicit page reload while malformed content remains locally recoverable", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: /assets/x.js",
    "error loading dynamically imported module",
    "Unable to preload CSS for /assets/x.css",
    "Loading chunk 4 failed",
  ])
    assert.equal(resourceLoadFailure(new TypeError(message)), true);
  assert.equal(resourceLoadFailure(new Error("malformed message")), false);
  assert.equal(resourceLoadFailure("network string"), false);
});
test("empty draft visits are pruned without removing text, attachments, skill choices or the current scope", () => {
  const d = new ComposerDrafts();
  const old = d.get("old"),
    current = d.get("current");
  for (let i = 0; i < 500; i++) d.get("visit-" + i);
  d.setText("text", "unsent");
  d.setFiles("file", [{ id: "f", name: "f.txt" }]);
  d.setSkills("skill", [
    { id: "s", displayName: "Skill", sha256: "hash" } as any,
  ]);
  d.pruneEmpty("current");
  assert.notEqual(d.get("old").generation, old.generation);
  assert.equal(d.get("current").generation, current.generation);
  assert.equal(d.get("text").text, "unsent");
  assert.equal(d.get("file").files.length, 1);
  assert.equal(d.get("skill").skills.length, 1);
  d.addFiles(old, [{ id: "late", name: "late" }]);
  assert.equal(d.get("old").files.length, 0);
});
test("identical rebuilds retain the last distinct asset generation while a new generation drops older assets", () => {
  const a = ["assets/a.js", "assets/font.woff2"],
    b = ["assets/b.js", "assets/font.woff2"],
    c = ["assets/c.js"];
  assert.deepEqual(retainedAssets(a, [], b), a);
  assert.deepEqual(retainedAssets(b, a, b), [...new Set([...a, ...b])].sort());
  assert.deepEqual(retainedAssets(b, a, c), b);
  assert.deepEqual(
    safeAssetPaths([
      "assets/../.env",
      "/assets/a.js",
      "assets/a.js",
      "assets/a.js",
      "assets//x",
      null,
    ]),
    ["assets/a.js"],
  );
});
test("full preference storage cannot break live UI state updates", () => {
  reset();
  const original = storage.setItem;
  storage.setItem = () => {
    throw Error("Quota exceeded");
  };
  try {
    assert.doesNotThrow(() => useApp.setState({ theme: "dark" }));
    assert.equal(useApp.getState().theme, "dark");
  } finally {
    storage.setItem = original;
  }
});
test("capabilities arriving after disconnect cannot resurrect features or start another stream", async () => {
  reset();
  let release!: (value: Response) => void;
  globalThis.fetch = (async () =>
    new Promise<Response>((r) => (release = r))) as any;
  connect();
  await until(() => !!release);
  disconnect();
  release(response(cap()));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(useApp.getState().abandonUnseen, false);
  assert.equal(Source.all.length, 0);
  assert.equal(useApp.getState().connected, false);
});
test("repeated connect and SSE open callbacks share one stream and one state synchronization", async () => {
  reset();
  const pending: { url: string; release: (v: Response) => void }[] = [];
  globalThis.fetch = (async (url: unknown) =>
    String(url).includes("capabilities")
      ? response(cap())
      : new Promise<Response>((r) =>
          pending.push({ url: String(url), release: r }),
        )) as any;
  connect();
  connect();
  await until(() => Source.all.length === 1);
  const source = Source.all[0];
  source.onopen?.();
  source.onopen?.();
  source.onopen?.();
  await until(() => pending.length >= 3);
  assert.equal(pending.length, 3);
  for (const p of pending)
    p.release(
      response(
        p.url.includes("/config")
          ? { models: [], providers: [], skills: [], mcp: [] }
          : [],
      ),
    );
  await until(() => useApp.getState().settings !== null);
  disconnect();
  assert.equal(source.closed, true);
});
test("late state reads and old 401 responses cannot replace a newer authenticated view", async () => {
  reset();
  let release!: (v: Response) => void;
  globalThis.fetch = (async () =>
    new Promise<Response>((r) => (release = r))) as any;
  const list = loadThreads();
  await until(() => !!release);
  disconnect();
  useApp.setState({
    authenticated: true,
    threads: [{ id: "new", title: "new" } as any],
  });
  release(response([{ id: "old", title: "old" }]));
  await list;
  assert.equal(useApp.getState().threads[0].id, "new");
  const old = request("thread/list");
  await until(() => !!release);
  disconnect();
  useApp.setState({ authenticated: true });
  release(response({}, 401));
  await assert.rejects(() => old);
  assert.equal(useApp.getState().authenticated, true);
});
test("disconnect invalidates history and configuration reads without clearing the current saved view", async () => {
  reset();
  const pending: { url: string; release: (v: Response) => void }[] = [];
  globalThis.fetch = (async (url: unknown) =>
    new Promise<Response>((r) =>
      pending.push({ url: String(url), release: r }),
    )) as any;
  const history = loadThread("old"),
    settings = loadSettings();
  await until(() => pending.length === 2);
  disconnect();
  useApp.setState({
    selectedId: "new",
    thread: { id: "new", turns: [] },
    settings: { models: [], providers: [], marker: "new" } as any,
  });
  for (const p of pending)
    p.release(
      response(
        p.url.includes("/config")
          ? { models: [], providers: [], marker: "old" }
          : { id: "old", turns: [] },
      ),
    );
  await Promise.all([history, settings]);
  assert.equal(useApp.getState().thread?.id, "new");
  assert.equal(useApp.getState().settings?.marker, "new");
});
test("late poll batches cannot deliver old runtime events after a connection is closed", async () => {
  reset();
  let release!: (v: Response) => void;
  let polls = 0;
  globalThis.fetch = (async (url: unknown) =>
    String(url).includes("capabilities")
      ? response(cap("poll"))
      : (polls++, new Promise<Response>((r) => (release = r)))) as any;
  connect();
  await until(() => polls === 1);
  disconnect();
  release(
    response({
      cursor: "old",
      events: [
        { type: "CUSTOM", name: "newbot.runtime", value: { state: "offline" } },
      ],
    }),
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(useApp.getState().runtime, "ready");
  assert.equal(useApp.getState().connected, false);
  assert.equal(polls, 1);
});
test("an old SSE session check cannot sign out a subsequent login", async () => {
  reset();
  let release!: (v: Response) => void;
  globalThis.fetch = (async (url: unknown) =>
    String(url).includes("capabilities")
      ? response(cap())
      : new Promise<Response>((r) => (release = r))) as any;
  connect();
  await until(() => Source.all.length === 1);
  Source.all[0].onerror?.();
  await until(() => !!release);
  disconnect();
  useApp.setState({ authenticated: true });
  release(response({ authenticated: false }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(useApp.getState().authenticated, true);
});

test("a flooded history hydration keeps a bounded buffer and rereads authority once without submitting a turn", async () => {
  reset();
  let release!: (v: Response) => void,
    reads = 0;
  globalThis.fetch = (async (url: unknown) => {
    assert.ok(String(url).startsWith("/api/threads/"));
    reads++;
    if (reads === 1) return new Promise<Response>((r) => (release = r));
    return response({
      id: "selected",
      revision: 9999,
      turns: [
        {
          id: "turn",
          status: "completed",
          items: [
            {
              id: "answer",
              type: "agentMessage",
              text: "authoritative after flood",
            },
          ],
        },
      ],
    });
  }) as any;
  const reading = loadThread("selected");
  for (let i = 0; i < 1100; i++)
    consume({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "answer",
      delta: "x",
      metadata: { threadId: "selected", runId: "turn", revision: i + 1 },
    } as any);
  release(response({ id: "selected", turns: [] }));
  await reading;
  assert.equal(reads, 2);
  assert.equal(
    useApp.getState().thread?.turns[0].items[0].text,
    "authoritative after flood",
  );
  assert.equal(useApp.getState().loading, false);
});
