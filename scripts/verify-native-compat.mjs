// Isolated native contract probe: never reads the application's Codex Home or credentials.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
const dir = await mkdtemp(tmpdir() + "/newbot-native-compat-");
const binary = process.env.CODEX_COMPAT_BIN || "node_modules/.bin/codex";
let child,
  stage = "setup",
  next = 0;
const requests = [],
  pending = new Map(),
  events = [],
  report = {};
const server = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  requests.push({
    path: req.url,
    first: body.includes("LOCAL_HISTORY_ONE"),
    second: body.includes("LOCAL_HISTORY_TWO"),
  });
  const index = requests.length,
    id = "resp_" + index,
    mid = "msg_" + index;
  const msg = {
    id: mid,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      { type: "output_text", text: "LOCAL_REPLY_" + index, annotations: [] },
    ],
  };
  const response = {
    id,
    object: "response",
    created_at: 1,
    status: "completed",
    model: "gpt-6.1-sol",
    output: [msg],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...msg, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      output_index: 0,
      item_id: mid,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      output_index: 0,
      item_id: mid,
      content_index: 0,
      delta: "LOCAL_REPLY_" + index,
    },
    { type: "response.output_item.done", output_index: 0, item: msg },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(event) + "\n\n");
  res.end();
});
try {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await writeFile(
    dir + "/config.toml",
    `model="gpt-6.1-sol"\nmodel_provider="probe_a"\nthread_unload_delay_secs=1\n[model_providers.probe_a]\nname="A"\nbase_url="http://127.0.0.1:${port}/a"\nwire_api="responses"\nrequires_openai_auth=false\n[model_providers.probe_b]\nname="B"\nbase_url="http://127.0.0.1:${port}/b"\nwire_api="responses"\nrequires_openai_auth=false\n`,
  );
  if (process.env.CODEX_COMPAT_PLUGINS) {
    await mkdir(dir + "/market/.agents/plugins", { recursive: true });
    await cp(
      "examples/test-plugin-marketplace/plugins/newbot-test-plugin",
      dir + "/market/plugin",
      {
        recursive: true,
      },
    );
    await writeFile(
      dir + "/market/.agents/plugins/marketplace.json",
      JSON.stringify({
        name: "newbot-local-tests",
        plugins: [
          {
            name: "newbot-test-plugin",
            source: { source: "local", path: "./plugin" },
          },
        ],
      }),
    );
    const added = spawnSync(
      binary,
      ["plugin", "marketplace", "add", dir + "/market", "--json"],
      {
        env: { PATH: process.env.PATH, HOME: dir, CODEX_HOME: dir },
        encoding: "utf8",
      },
    );
    if (added.status !== 0) throw Error("marketplace setup failed");
  }
  child = spawn(binary, ["app-server", "--listen", "stdio://"], {
    env: { PATH: process.env.PATH, CODEX_HOME: dir, HOME: dir },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  child.on("error", (e) => {
    for (const p of pending.values()) p.reject(e);
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (e.id !== undefined && pending.has(e.id)) {
      const p = pending.get(e.id);
      pending.delete(e.id);
      e.error ? p.reject(Error(JSON.stringify(e.error))) : p.resolve(e.result);
    } else events.push(e);
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++next,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("timeout " + method));
        }, 15000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  const wait = async (test) => {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const e = events.find(test);
      if (e) return e;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error("notification timeout");
  };
  stage = "initialize";
  report.initialize = await call("initialize", {
    clientInfo: { name: "newbot_compat_probe", version: "1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write('{"method":"initialized"}\n');
  stage = "plugin-discovery";
  try {
    const p = await call("plugin/list", { marketplaceKinds: ["local"] });
    report.plugins = {
      discovery: true,
      marketplaces: p.marketplaces?.length ?? 0,
    };
  } catch {
    report.plugins = { discovery: false };
  }
  if (process.env.CODEX_COMPAT_PLUGINS) {
    stage = "plugin-lifecycle";
    let listed = await call("plugin/list", { marketplaceKinds: ["local"] });
    report.pluginProbe = listed;
    const marketplace = listed.marketplaces.find(
      (m) => m.name === "newbot-local-tests",
    );
    if (!marketplace?.plugins.length) throw Error("fixture plugin missing");
    const plugin = marketplace.plugins[0],
      params = { marketplacePath: marketplace.path, pluginName: plugin.name };
    await call("plugin/install", params);
    const detail = await call("plugin/read", params);
    report.pluginSkills = detail.plugin.skills.map((s) => ({
      name: s.name,
      enabled: s.enabled,
    }));
    const beforeSkills = await call("skills/list", {
      cwds: [dir],
      forceReload: true,
    });
    report.enabledPluginSkills = beforeSkills.data
      .flatMap((d) => d.skills)
      .filter((s) => s.name.startsWith("newbot-test-plugin:"))
      .map((s) => ({ name: s.name, enabled: s.enabled }));
    const cfg = await call("config/read", { cwd: dir, includeLayers: true });
    report.pluginConfig = cfg.config.plugins;
    const user = cfg.layers.find(
      (l) => l.name.type === "user" && !l.name.profile,
    );
    await call("config/batchWrite", {
      filePath: user.name.file,
      expectedVersion: user.version,
      edits: [
        {
          keyPath: `plugins.${JSON.stringify(plugin.id)}.enabled`,
          value: false,
          mergeStrategy: "replace",
        },
      ],
    });
    const disabled = await call("plugin/read", params);
    report.pluginDisabled = {
      enabled: disabled.plugin.summary.enabled,
      skills: disabled.plugin.skills.map((s) => ({
        name: s.name,
        enabled: s.enabled,
      })),
    };
    const afterSkills = await call("skills/list", {
      cwds: [dir],
      forceReload: true,
    });
    report.disabledPluginSkills = afterSkills.data
      .flatMap((d) => d.skills)
      .filter((s) => s.name.startsWith("newbot-test-plugin:"))
      .map((s) => ({ name: s.name, enabled: s.enabled }));
    if (report.disabledPluginSkills.some((s) => s.enabled))
      throw Error("disabled plugin still exposes enabled skills");
    await call("plugin/uninstall", { pluginId: plugin.id });
    report.pluginLifecycle = true;
  }
  report.approvalPresets = [];
  for (const preset of [
    {
      id: "ask",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    },
    {
      id: "review",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
    },
    {
      id: "full",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
    },
  ]) {
    const { id: label, ...params } = preset;
    const r = await call("thread/start", { cwd: dir, ...params });
    report.approvalPresets.push({
      id: label,
      policy: r.approvalPolicy,
      reviewer: r.approvalsReviewer,
      sandbox: r.sandbox.type,
    });
  }
  stage = "first-thread";
  const start = await call("thread/start", {
    cwd: dir,
    modelProvider: "probe_a",
    model: "gpt-6.1-sol",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
  });
  const id = start.thread.id;
  report.approval = {
    policy: start.approvalPolicy,
    reviewer: start.approvalsReviewer,
  };
  const run = async (marker) => {
    const r = await call("turn/start", {
      threadId: id,
      input: [{ type: "text", text: marker, text_elements: [] }],
    });
    return wait(
      (e) => e.method === "turn/completed" && e.params.turn.id === r.turn.id,
    );
  };
  stage = "first-turn";
  await run("LOCAL_HISTORY_ONE");
  stage = "unsubscribe";
  report.unsubscribe = await call("thread/unsubscribe", { threadId: id });
  await wait((e) => e.method === "thread/closed" && e.params.threadId === id);
  stage = "cross-provider-resume";
  const resumed = await call("thread/resume", {
    threadId: id,
    modelProvider: "probe_b",
    model: "gpt-6.1-sol",
    excludeTurns: true,
  });
  report.resumedProvider = resumed.modelProvider;
  report.sameThread = resumed.thread.id === id;
  stage = "second-turn";
  report.secondStatus = (await run("LOCAL_HISTORY_TWO")).params.turn.status;
  stage = "history";
  const read = await call("thread/read", { threadId: id, includeTurns: true });
  report.turns = read.thread.turns.length;
  report.crossProviderPassed =
    report.sameThread &&
    report.turns === 2 &&
    requests.at(-1)?.path === "/b/responses" &&
    requests.at(-1)?.first &&
    requests.at(-1)?.second;
} catch (e) {
  report.failure = { stage, error: e.message };
  report.crossProviderPassed = false;
  process.exitCode = 1;
} finally {
  for (const p of pending.values()) p.reject(Error("probe closed"));
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
    await new Promise((r) =>
      child.exitCode !== null || child.signalCode !== null
        ? r()
        : child.once("exit", r),
    );
  }
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
report.requests = requests;
console.log(JSON.stringify(report, null, 2));
if (process.env.CODEX_COMPAT_REPORT) {
  await mkdir(
    new URL(".", new URL("file://" + process.env.CODEX_COMPAT_REPORT)),
    { recursive: true },
  );
  await writeFile(
    process.env.CODEX_COMPAT_REPORT,
    JSON.stringify(report, null, 2) + "\n",
  );
}
