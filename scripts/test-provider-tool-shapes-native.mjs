// Pinned native runtime, isolated homes, synthetic Responses + stdio MCP only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Codex } from "../server/codex.ts";
const root = await mkdtemp(join(tmpdir(), "newbot-tool-shapes-"));
const evidence = resolve(
  ".issue/2026-11-11/evidence-app-presentation-provider-tools",
);
await mkdir(evidence, { recursive: true });
const mcp = join(root, "mcp.mjs"),
  calls = join(root, "calls.jsonl");
await writeFile(
  mcp,
  `import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
createInterface({input:process.stdin}).on('line',line=>{try{const r=JSON.parse(line);if(r.id===undefined)return;let result={};
if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'shape-probe',version:'1'}};
if(r.method==='tools/list')result={tools:[{name:'probe',title:'读取测试数据',description:'Return synthetic probe data',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}]};
if(r.method==='tools/call'){appendFileSync(${JSON.stringify(calls)},JSON.stringify(r.params)+'\\n');result={content:[{type:'text',text:'SHAPE_PROBE_OK'}]};}
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');}catch{}});`,
);
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
const cases = [
  { name: "minimax-default", model: "minimax-m3.1-flash", features: {} },
  {
    name: "minimax-nonprefixed",
    model: "minimax-m3.1-flash",
    features: { non_prefixed_mcp_tool_names: true },
  },
  {
    name: "minimax-no-incremental",
    model: "minimax-m3.1-flash",
    features: { incremental_tools: false },
  },
  {
    name: "minimax-no-code-host",
    model: "minimax-m3.1-flash",
    features: { code_mode_host: false },
  },
  {
    name: "minimax-dropping-gateway",
    model: "minimax-m3.1-flash",
    features: {},
    dropNamespaces: true,
  },
  { name: "deepseek-control", model: "deepseek-flash", features: {} },
  { name: "gpt-control", model: "gpt-6-sol", features: {} },
];
let current;
const results = [];
const walk = (tools, namespace) =>
  (tools || []).flatMap((t) =>
    t.type === "namespace"
      ? walk(t.tools, t.name)
      : [{ type: t.type, name: t.name, namespace }],
  );
const upstream = createServer(async (req, res) => {
  try {
    if (req.url.endsWith("/models")) {
      res.end(JSON.stringify({ data: cases.map((c) => ({ id: c.model })) }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      all =
        body.tools ||
        body.input?.find((i) => i.type === "additional_tools")?.tools ||
        [];
    const shapes = walk(all);
    current.requests.push({
      tools: shapes,
      hasResult: raw.includes("SHAPE_PROBE_OK"),
      outputs: (body.input || [])
        .filter((i) => i.type.endsWith("call_output"))
        .map((i) => ({ type: i.type, output: i.output })),
    });
    const num = current.requests.length,
      id = "r_" + num;
    let item;
    if (num === 1) {
      const effective = current.dropNamespaces
        ? shapes.filter((t) => !t.namespace)
        : shapes;
      const direct = effective.find((t) => /probe$/.test(t.name || ""));
      const exec = effective.find(
        (t) => t.name === "exec" && t.type === "custom",
      );
      if (direct)
        item = {
          type: "function_call",
          id: "fc_" + num,
          call_id: "call_" + num,
          name: direct.name,
          ...(direct.namespace ? { namespace: direct.namespace } : {}),
          arguments: JSON.stringify({ value: "synthetic" }),
          status: "completed",
        };
      else if (exec)
        item = {
          type: "custom_tool_call",
          id: "fc_" + num,
          call_id: "call_" + num,
          name: exec.name,
          ...(exec.namespace ? { namespace: exec.namespace } : {}),
          input:
            'const t=ALL_TOOLS.find(t=>/mcp__.*probe$/.test(t.name)); if(!t) throw Error("missing probe"); text(await tools[t.name]({value:"synthetic"}));',
          status: "completed",
        };
    }
    item ||= {
      type: "message",
      id: "msg_" + num,
      role: "assistant",
      status: "completed",
      content: [
        { type: "output_text", text: "SYNTHETIC_DONE", annotations: [] },
      ],
    };
    const response = {
      id,
      object: "response",
      created_at: 1,
      model: body.model,
      status: "completed",
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    const events = [
      {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, status: "in_progress" },
      },
    ];
    if (item.type === "function_call")
      events.push({
        type: "response.function_call_arguments.done",
        output_index: 0,
        item_id: item.id,
        arguments: item.arguments,
      });
    if (item.type === "custom_tool_call")
      events.push({
        type: "response.custom_tool_call_input.done",
        output_index: 0,
        item_id: item.id,
        input: item.input,
      });
    events.push(
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    );
    for (const event of events)
      res.write("data: " + JSON.stringify(event) + "\n\n");
    res.end();
  } catch (e) {
    current.error = String(e);
    res.writeHead(500);
    res.end("synthetic failure");
  }
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
try {
  for (const c of cases) {
    current = { ...c, requests: [] };
    results.push(current);
    const cwd = join(root, c.name),
      home = join(cwd, "codex");
    await mkdir(home, { recursive: true });
    const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
    try {
      await native.start();
      assert.equal(native.state, "ready");
      native.on("approval", (a) => {
        assert.equal(a.params.serverName, "shape");
        native.respond(a.id, { action: "accept", content: {}, _meta: null });
      });
      const completed = new Map();
      native.on("event", (e) => {
        if (e.method === "turn/completed")
          completed.set(e.params.turn.id, e.params.turn);
      });
      const t = await native.call("thread/start", {
        cwd,
        model: c.model,
        modelProvider: "mock",
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        config: {
          features: c.features,
          model_providers: {
            mock: {
              name: "Synthetic",
              base_url: "http://127.0.0.1:" + upstream.address().port,
              wire_api: "responses",
              request_max_retries: 0,
              stream_max_retries: 0,
            },
          },
          mcp_servers: { shape: { command: process.execPath, args: [mcp] } },
        },
      });
      const catalog = await native.call("mcpServerStatus/list", {
        threadId: t.thread.id,
      });
      current.mcpDiscovered = Object.keys(
        catalog.data.find((s) => s.name === "shape")?.tools || {},
      );
      const turn = await native.call("turn/start", {
        threadId: t.thread.id,
        input: [
          {
            type: "text",
            text: "Use the shape probe with value synthetic.",
            text_elements: [],
          },
        ],
      });
      const until = Date.now() + 30000;
      while (!completed.has(turn.turn.id) && Date.now() < until)
        await new Promise((r) => setTimeout(r, 50));
      current.status = completed.get(turn.turn.id)?.status || "timeout";
      current.success = current.requests.some((r) => r.hasResult);
    } catch (e) {
      current.error = String(e);
    } finally {
      native.stop();
    }
    console.log(
      JSON.stringify({
        case: c.name,
        status: current.status,
        success: current.success,
        tools: current.requests[0]?.tools,
        error: current.error,
      }),
    );
  }
  for (const result of results) {
    assert.equal(result.status, "completed");
    assert.equal(result.success, !result.dropNamespaces, result.name);
  }
  const summary = {
    runtime: "0.165.0",
    syntheticOnly: true,
    results,
    mcpCalls: (await readFile(calls, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean).length,
  };
  await writeFile(
    join(evidence, "native-tool-shapes.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
} finally {
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
}
