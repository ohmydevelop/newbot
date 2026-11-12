import { test } from "node:test";
import assert from "node:assert/strict";
import {
  modelPurpose,
  modelDescriptor,
  chatCandidate,
} from "../shared/model-purpose.js";
import {
  verifyResponsesCapabilities,
  capabilityKey,
} from "../server/model-capabilities.js";

const stream = (response: any) =>
  new Response(
    `data: ${JSON.stringify({ type: "response.created", response: { status: "in_progress" } })}\n\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
function gateway(options: { broken?: string; usage?: number } = {}) {
  const requests: any[] = [];
  return {
    requests,
    send: async (body: any) => {
      requests.push(body);
      const nonce = body.input[0].content.match(/nonce ([a-f0-9]+)\./)[1];
      const output =
        body.tool_choice === "none"
          ? [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text:
                      options.broken === "result"
                        ? "wrong"
                        : `VERIFIED_${nonce}`,
                  },
                ],
              },
            ]
          : [
              {
                type: "function_call",
                call_id: "call1",
                name:
                  options.broken === "tool"
                    ? "shell"
                    : "newbot_capability_probe",
                arguments: JSON.stringify({ nonce }),
              },
            ];
      return stream({
        status: "completed",
        output,
        usage: { input_tokens: options.usage ?? 32000 },
      });
    },
  };
}
test("non-chat purposes excluded; explicit chat metadata takes priority over ambiguous identifiers", () => {
  for (const id of [
    "bge-m3",
    "bge-reranker-v2-m3",
    "text-embedding-3-large",
    "vendor/qwen3-embedding",
    "e5-large",
    "gte-large",
    "whisper-1",
    "gpt-image-1",
  ])
    assert.equal(chatCandidate(modelPurpose(id)), false, id);
  assert.equal(
    modelPurpose("opaque-alias", { task: "feature_extraction" }),
    "embedding",
  );
  assert.equal(
    modelPurpose("bge-chat-alias", { task: "text-generation" }),
    "chat",
  );
  assert.equal(
    modelPurpose("universal", {
      capabilities: { chat: true, embeddings: true },
    }),
    "chat",
  );
  assert.equal(modelPurpose("deepseek-flash"), "unknown");
  assert.equal(modelPurpose("minimax-m3.1-flash"), "unknown");
  assert.equal(
    modelDescriptor("x", { context_length: 64000 }).contextWindow,
    64000,
  );
});
test("synthetic probe verifies tool continuation, preserves selected effort and records observed bounded capacity", async () => {
  const g = gateway();
  const result = await verifyResponsesCapabilities(
    "secondary",
    "chat-alias",
    g.send,
    "medium",
  );
  assert.deepEqual(result, {
    providerId: "secondary",
    model: "chat-alias",
    contextWindow: 25600,
    reasoningEffort: "medium",
  });
  assert.equal(g.requests.length, 2);
  assert.equal(g.requests[1].input.at(-1).type, "function_call_output");
  assert.equal(g.requests[0].tools.length, 1);
  assert.equal(g.requests[0].tools[0].name, "newbot_capability_probe");
  assert.deepEqual(g.requests[0].reasoning, { effort: "medium" });
  assert.equal(g.requests[0].store, false);
});
test("no capability success for invalid tool, ignored result, missing usage or non-streaming response", async () => {
  for (const options of [
    { broken: "tool" },
    { broken: "result" },
    { usage: 0 },
  ])
    await assert.rejects(
      verifyResponsesCapabilities("a", "x", gateway(options).send),
    );
  await assert.rejects(
    verifyResponsesCapabilities(
      "a",
      "x",
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
    /流式/,
  );
});
test("capability records cannot be reused across provider, endpoint, credentials or reasoning effort", () => {
  const key = capabilityKey("a", "x", { base_url: "https://a.test" }, [
    "secret",
    "low",
  ]);
  for (const values of [
    ["b", "x", { base_url: "https://a.test" }, ["secret", "low"]],
    ["a", "x", { base_url: "https://b.test" }, ["secret", "low"]],
    ["a", "x", { base_url: "https://a.test" }, ["new", "low"]],
    ["a", "x", { base_url: "https://a.test" }, ["secret", "high"]],
  ] as const)
    assert.notEqual(
      key,
      capabilityKey(values[0], values[1], values[2], values[3]),
    );
  assert.ok(!key.includes("secret"));
});

test("streaming verification preserves actionable billing errors without forwarding upstream secrets", async () => {
  await assert.rejects(
    verifyResponsesCapabilities(
      "a",
      "x",
      async () =>
        new Response(
          `data: ${JSON.stringify({ type: "response.failed", response: { error: { code: "insufficient_balance", message: "secret upstream token" } } })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
    ),
    (error: any) =>
      error.message.includes("余额不足") && !error.message.includes("secret"),
  );
});
