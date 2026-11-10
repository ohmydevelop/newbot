import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseInputForm,
  validateInput,
  INPUT_LIMITS,
} from "../shared/elicitation.js";
import type { Approval } from "../shared/types.js";
import { inputSchema } from "../examples/test-elicitation/schema.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
const request = (schema: unknown = inputSchema, params = {}): Approval => ({
  id: 41,
  method: "mcpServer/elicitation/request",
  params: {
    threadId: "thread",
    turnId: "turn",
    serverName: "input-test",
    mode: "form",
    _meta: null,
    message: "填写测试参数",
    requestedSchema: schema,
    ...params,
  },
});
const values = {
  task_name: "SYNTHETIC_PUBLIC_INPUT",
  server: "node-b",
  threshold: 80,
  interval: 0.5,
  notify: false,
  metrics: ["CPU", "内存"],
};
test("limited native schemas preserve scalar types, defaults and enum variants without auto-submission", () => {
  const { form } = parseInputForm(request());
  assert.ok(form);
  assert.equal(form.fields.length, 6);
  assert.equal(form.fields.find((f) => f.name === "notify")?.default, false);
  assert.deepEqual(validateInput(form, values), {
    invalid: false,
    errors: {},
    content: values,
  });
  const schema = {
    type: "object",
    properties: {
      one: {
        type: "string",
        oneOf: [
          { const: "", title: "空选项" },
          { const: "x", title: "X" },
        ],
      },
      many: {
        type: "array",
        items: { anyOf: [{ const: "a", title: "A" }] },
        minItems: 0,
      },
    },
  };
  const parsed = parseInputForm(request(schema)).form!;
  assert.ok(parsed);
  assert.equal(validateInput(parsed, { one: "", many: [] }).invalid, false);
});
test("secret, URL, rich form and tool-consent requests cannot become ordinary input forms", () => {
  for (const p of [
    { mode: "url", url: "https://private.invalid/secret" },
    { mode: "openai/form" },
    { _meta: { codex_approval_kind: "mcp_tool_call" } },
  ])
    assert.equal(parseInputForm(request(inputSchema, p)).issue, "unsupported");
  for (const name of ["password", "API_Key", "私钥", "otp"])
    assert.equal(
      parseInputForm(
        request({ type: "object", properties: { [name]: { type: "string" } } }),
      ).issue,
      "sensitive",
    );
  assert.equal(
    parseInputForm(request(inputSchema, { message: "请输入验证码" })).issue,
    "sensitive",
  );
});
test("unknown schema keywords, nested objects, prototypes and ambiguous or malformed options are refused", () => {
  const invalid = [
    { type: "string", pattern: "(a+)+$" },
    { type: "object", properties: {} },
    { type: "string", format: "password" },
    { type: "string", enum: ["a", "a"] },
    { type: "string", enum: ["a"], enumNames: [] },
    { type: "number", minimum: 10, maximum: 1 },
    { type: "boolean", default: "false" },
    { type: "array", items: { type: "string", enum: ["a"] }, maxItems: 2 },
  ];
  for (const field of invalid)
    assert.ok(
      parseInputForm(request({ type: "object", properties: { field } })).issue,
    );
  for (const name of ["constructor", "toString", "__proto__"])
    assert.ok(
      parseInputForm(
        request({
          type: "object",
          properties: JSON.parse(`{"${name}":{"type":"string"}}`),
        }),
      ).issue,
    );
  assert.ok(
    parseInputForm(request({ ...inputSchema, required: ["unknown"] })).issue,
  );
  assert.ok(
    parseInputForm(request({ ...inputSchema, additionalProperties: true }))
      .issue,
  );
});
test("schema and content sizes are bounded by UTF-8 bytes and fields/options have fixed limits", () => {
  assert.equal(
    parseInputForm(
      request({
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: 13 }, (_, i) => [`f${i}`, { type: "boolean" }]),
        ),
      }),
    ).issue,
    "limit",
  );
  assert.ok(
    parseInputForm(
      request({
        type: "object",
        properties: {
          f: {
            type: "string",
            enum: Array.from({ length: 33 }, (_, i) => String(i)),
          },
        },
      }),
    ).issue,
  );
  assert.equal(
    parseInputForm(
      request({
        ...inputSchema,
        unsupported: "中".repeat(INPUT_LIMITS.schemaBytes / 2),
      }),
    ).issue,
    "limit",
  );
  const form = parseInputForm(
    request({
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          `f${i}`,
          { type: "string", maxLength: 2000 },
        ]),
      ),
    }),
  ).form!;
  assert.equal(
    validateInput(
      form,
      Object.fromEntries(form.fields.map((f) => [f.name, "中".repeat(1000)])),
    ).invalid,
    true,
  );
});
test("required, extra, coercible, out-of-range and duplicate input values fail while false and zero retain their types", () => {
  const form = parseInputForm(request()).form!;
  for (const patch of [
    { threshold: "80" },
    { threshold: 80.5 },
    { threshold: 101 },
    { notify: "false" },
    { metrics: ["CPU", "CPU"] },
    { server: "other" },
    { extra: "ignored?" },
  ])
    assert.equal(validateInput(form, { ...values, ...patch }).invalid, true);
  assert.equal(validateInput(form, {}).invalid, true);
  const numeric = parseInputForm(
    request({
      type: "object",
      properties: { n: { type: "number" }, b: { type: "boolean" } },
      required: ["n", "b"],
    }),
  ).form!;
  assert.deepEqual(validateInput(numeric, { n: 0, b: false }).content, {
    n: 0,
    b: false,
  });
  assert.equal(validateInput(numeric, { n: Infinity, b: false }).invalid, true);
});
test("supported formats validate actual dates and restrict URI input without navigating or fetching", () => {
  for (const [format, good, bad] of [
    ["email", "a@example.test", "bad"],
    ["uri", "https://example.test/path", "https://user:pass@example.test"],
    ["date", "2024-02-29", "2025-02-29"],
    ["date-time", "2024-02-29T10:20:00Z", "2025-02-30T10:20:00Z"],
  ]) {
    const form = parseInputForm(
      request({
        type: "object",
        properties: { field: { type: "string", format } },
      }),
    ).form!;
    assert.equal(validateInput(form, { field: good }).invalid, false);
    assert.equal(validateInput(form, { field: bad }).invalid, true);
  }
});
async function fixture(fn: (f: any) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-input-")),
    codex = new FakeCodex(),
    ctx = await createServer({
    providerRuntime: null,
      directory,
      cwd: join(directory, "work"),
      codex,
      password: "input-tests-password",
      origins: ["http://127.0.0.1:3100"],
    });
  const sent: any[] = [],
    events: any[] = [];
  (codex as any).send = (v: any) => sent.push(v);
  ctx.service.events.on("event", (v: any) => events.push(v));
  try {
    const thread: any = await ctx.service.handle("thread/start", {}),
      login = await ctx.app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin: "http://127.0.0.1:3100" },
        payload: { password: "input-tests-password" },
      }),
      headers = {
        origin: "http://127.0.0.1:3100",
        cookie: String(login.headers["set-cookie"]).split(";")[0],
      };
    const put = (changes = {}) => {
        const a = request(inputSchema, { threadId: thread.id, ...changes });
        codex.approvals.set(a.id, a as any);
        codex.emit("approval", a);
        return a;
      },
      list = () =>
        ctx.service.handle("approval/list", {}) as Promise<Approval[]>,
      post = (body: any, h = headers) =>
        ctx.app.inject({
          method: "POST",
          url: "/api/agent/action",
          headers: h,
          payload: { action: "elicitation/respond", ...body },
        });
    await fn({ ...ctx, codex, thread, headers, sent, events, put, list, post });
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
test("accepted HTTP input reaches the original native request once with strict types and null client metadata", async () =>
  fixture(async (f) => {
    f.put({ _meta: { SYNTHETIC_PRIVATE_META: "hidden" } });
    const a = (await f.list())[0],
      token = a.params.elicitation.token;
    assert.equal(
      (await f.post({ id: a.id, token, decision: "accept", content: values }))
        .statusCode,
      200,
    );
    assert.deepEqual(f.sent, [
      { id: a.id, result: { action: "accept", content: values, _meta: null } },
    ]);
    assert.equal(
      (await f.post({ id: a.id, token, decision: "accept", content: values }))
        .statusCode,
      410,
    );
    assert.doesNotMatch(
      JSON.stringify(f.db.raw.prepare("SELECT * FROM audit").all()),
      /SYNTHETIC_PUBLIC_INPUT/,
    );
    assert.doesNotMatch(
      JSON.stringify(f.events),
      /SYNTHETIC_PRIVATE_META|SYNTHETIC_PUBLIC_INPUT/,
    );
  }));
test("generic allow cannot bypass input validation; invalid submissions preserve the original pending request", async () =>
  fixture(async (f) => {
    f.put();
    const a = (await f.list())[0],
      token = a.params.elicitation.token;
    assert.equal(
      (
        await f.post({
          action: "approval/respond",
          id: a.id,
          allow: true,
          content: values,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.post({
          id: a.id,
          token,
          decision: "accept",
          content: { ...values, notify: "false" },
        })
      ).statusCode,
      400,
    );
    assert.equal(f.sent.length, 0);
    assert.equal((await f.list())[0].params.elicitation.token, token);
    assert.equal(
      (await f.post({ id: a.id, token, decision: "accept", content: values }))
        .statusCode,
      200,
    );
  }));
test("cancel and decline send distinct empty native outcomes; cancelled draft data is never forwarded", async () =>
  fixture(async (f) => {
    for (const decision of ["cancel", "decline"]) {
      f.put();
      const a = (await f.list())[0];
      assert.equal(
        (
          await f.post({
            id: a.id,
            token: a.params.elicitation.token,
            decision,
            content: values,
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await f.post({
            id: a.id,
            token: a.params.elicitation.token,
            decision,
          })
        ).statusCode,
        200,
      );
      assert.deepEqual(f.sent.at(-1).result, {
        action: decision,
        content: null,
        _meta: null,
      });
    }
  }));
test("repeated discovery does not extend deadlines, and server-side expiry cancels a form without a browser", async () =>
  fixture(async (f) => {
    f.put();
    const a = (await f.list())[0],
      b = (await f.list())[0];
    assert.equal(
      a.params.elicitation.expiresAt,
      b.params.elicitation.expiresAt,
    );
    f.service.elicitation.pending.get(a.id).expiresAt = Date.now() - 1;
    f.service.elicitation.expire();
    f.service.elicitation.expire();
    assert.deepEqual(f.sent, [
      { id: a.id, result: { action: "cancel", content: null, _meta: null } },
    ]);
    assert.equal((await f.list()).length, 0);
    assert.equal(
      (
        await f.post({
          id: a.id,
          token: a.params.elicitation.token,
          decision: "accept",
          content: values,
        })
      ).statusCode,
      410,
    );
  }));
test("a failed expiry response marks the runtime disconnected without claiming a confirmed cancellation", async () =>
  fixture(async (f) => {
    const a = f.put();
    f.service.elicitation.pending.get(a.id).expiresAt = Date.now() - 1;
    f.codex.send = () => {
      throw Error("SYNTHETIC_TRANSPORT_FAILURE");
    };
    f.service.elicitation.expire();
    assert.equal(f.codex.state, "offline");
    assert.equal(f.service.elicitation.pending.size, 0);
    assert.equal(
      f.events.some((e: any) => e.name === "newbot.elicitation.expired"),
      false,
    );
    assert.doesNotMatch(
      JSON.stringify(f.events),
      /SYNTHETIC_TRANSPORT_FAILURE/,
    );
  }));
test("concurrent requests race safely and a reused native id cannot consume a newer request using an old token", async () =>
  fixture(async (f) => {
    f.put();
    const a = (await f.list())[0],
      payload = {
        id: a.id,
        token: a.params.elicitation.token,
        decision: "accept",
        content: values,
      };
    const results = await Promise.all([f.post(payload), f.post(payload)]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 410]);
    assert.equal(f.sent.length, 1);
    f.put();
    assert.equal((await f.post(payload)).statusCode, 410);
    assert.equal(f.codex.approvals.size, 1);
  }));
test("unsupported schemas and private defaults are absent from discovery and event snapshots and cannot be accepted", async () =>
  fixture(async (f) => {
    f.put({
      mode: "url",
      url: "https://hidden.invalid/SYNTHETIC_PRIVATE_URL",
      message: "SYNTHETIC_PRIVATE_MESSAGE",
      _meta: { secret: "SYNTHETIC_PRIVATE_META" },
      requestedSchema: {
        type: "object",
        properties: {
          password: { type: "string", default: "SYNTHETIC_PRIVATE_DEFAULT" },
        },
      },
    });
    const list = await f.list(),
      a = list[0],
      poll = await f.app.inject({
        url: "/api/agent/events?transport=poll",
        headers: f.headers,
      });
    assert.doesNotMatch(
      JSON.stringify(list) + poll.body,
      /SYNTHETIC_PRIVATE|hidden.invalid/,
    );
    assert.equal(a.params.elicitation.form, undefined);
    assert.equal(
      (
        await f.post({
          id: a.id,
          token: a.params.elicitation.token,
          decision: "accept",
          content: {},
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.post({
          id: a.id,
          token: a.params.elicitation.token,
          decision: "cancel",
        })
      ).statusCode,
      200,
    );
  }));
test("response controls require login, main origin, matching request token and an owned thread", async () =>
  fixture(async (f) => {
    f.put();
    const a = (await f.list())[0],
      payload = {
        id: a.id,
        token: a.params.elicitation.token,
        decision: "accept",
        content: values,
      };
    assert.equal(
      (await f.post(payload, { origin: f.headers.origin })).statusCode,
      401,
    );
    assert.equal(
      (await f.post(payload, { ...f.headers, origin: "https://other.invalid" }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await f.post({
          ...payload,
          token: "00000000-0000-4000-8000-000000000000",
        })
      ).statusCode,
      410,
    );
    f.put({ threadId: "foreign" });
    assert.equal((await f.post(payload)).statusCode, 410);
    assert.equal(f.sent.length, 0);
  }));
test("native resolution, task completion and process loss cannot leave an input active for a future runtime", async () =>
  fixture(async (f) => {
    const a = f.put();
    f.codex.emit("event", {
      method: "turn/completed",
      params: { threadId: f.thread.id, turn: { id: "turn" } },
    });
    assert.equal(f.codex.approvals.has(a.id), false);
    assert.equal(f.sent[0].result.action, "cancel");
    f.put();
    f.codex.offline("synthetic");
    assert.equal(f.service.elicitation.pending.size, 0);
    assert.equal((await f.list()).length, 0);
  }));
