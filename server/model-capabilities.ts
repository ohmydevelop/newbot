import { publicFailure } from "./failure.js";
import { randomBytes, createHash } from "node:crypto";
import { PublicError } from "./public-error.js";

export type VerifiedCapabilities = {
  providerId: string;
  model: string;
  contextWindow: number;
  reasoningEffort?: string;
};
export const capabilityKey = (
  provider: string,
  model: string,
  definition: unknown,
  credentials: unknown,
) =>
  `model-capability-v1:${createHash("sha256")
    .update(JSON.stringify([provider, model, definition, credentials]))
    .digest("hex")}`;

/** Synthetic function calls only. No tool dispatcher or conversation data is used. */
export async function verifyResponsesCapabilities(
  providerId: string,
  model: string,
  request: (body: unknown) => Promise<Response>,
  reasoningEffort?: string,
): Promise<VerifiedCapabilities> {
  const nonce = randomBytes(16).toString("hex");
  // An observed input size is a lower bound, never the provider's advertised maximum.
  const padding = randomBytes(32768).toString("base64");
  const input: any[] = [
    {
      role: "user",
      content: `Compatibility test. Ignore the opaque padding below. Call newbot_capability_probe with nonce ${nonce}. After its result, reply with the result verbatim.\n<opaque>${padding}</opaque>`,
    },
  ];
  const tools = [
    {
      type: "function",
      name: "newbot_capability_probe",
      description: "Returns a synthetic verification marker; no side effects.",
      parameters: {
        type: "object",
        properties: { nonce: { type: "string" } },
        required: ["nonce"],
        additionalProperties: false,
      },
      strict: true,
    },
  ];
  async function run(input: any[], toolChoice: unknown) {
    const response = await request({
      model,
      input,
      tools,
      tool_choice: toolChoice,
      stream: true,
      store: false,
      max_output_tokens: 2048,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    });
    if (!/text\/event-stream/i.test(response.headers.get("content-type") || ""))
      throw new PublicError(
        "该模型未返回 Responses 流式事件，无法验证任务内切换",
      );
    const reader = response.body?.getReader();
    if (!reader) throw new PublicError("模型能力验证没有收到响应");
    const decoder = new TextDecoder();
    let buffer = "",
      bytes = 0,
      completed: any;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 1024 * 1024)
          throw new PublicError("模型能力验证响应超过限制");
        buffer += decoder.decode(next.value, { stream: true });
        let offset: number;
        while ((offset = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, offset).trim();
          buffer = buffer.slice(offset + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const event = JSON.parse(data);
          if (event.type === "response.completed") completed = event.response;
          if (
            ["error", "response.failed", "response.incomplete"].includes(
              event.type,
            )
          ) {
            const error = event.response?.error || event.error || event;
            const failure = publicFailure({
              message: [error.code, error.type, error.message]
                .filter((v) => typeof v === "string")
                .join(" "),
            });
            throw new PublicError(
              failure.category !== "unknown"
                ? `${failure.message}${failure.action || ""}`
                : "模型未完成能力验证；原会话设置保持不变",
            );
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (
      !completed ||
      completed.status !== "completed" ||
      !Array.isArray(completed.output)
    )
      throw new PublicError("模型没有返回完整的 Responses 结束事件");
    return completed;
  }
  const first = await run(input, {
    type: "function",
    name: "newbot_capability_probe",
  });
  const calls = first.output.filter((v: any) => v.type === "function_call");
  if (
    calls.length !== 1 ||
    calls[0].name !== "newbot_capability_probe" ||
    !calls[0].call_id ||
    JSON.parse(calls[0].arguments)?.nonce !== nonce
  )
    throw new PublicError("该模型未通过标准工具调用验证，不能用于此次热切换");
  const marker = `VERIFIED_${nonce}`;
  const second = await run(
    [
      ...input,
      ...first.output,
      {
        type: "function_call_output",
        call_id: calls[0].call_id,
        output: marker,
      },
    ],
    "none",
  );
  const text = second.output
    .flatMap((v: any) => (v.type === "message" ? v.content || [] : []))
    .filter((v: any) => v.type === "output_text")
    .map((v: any) => v.text)
    .join("");
  if (
    !text.includes(marker) ||
    second.output.some((v: any) => v.type === "function_call")
  )
    throw new PublicError("该模型未通过工具结果续接验证，原设置保持不变");
  const observed = Math.min(
    Number(first.usage?.input_tokens),
    Number(second.usage?.input_tokens),
  );
  const contextWindow = Math.min(65536, Math.floor(observed * 0.8));
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 4096)
    throw new PublicError(
      "上游未提供足够的输入用量证据，无法确认安全的上下文范围",
    );
  return {
    providerId,
    model,
    contextWindow,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}
