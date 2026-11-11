import { PublicError } from "./public-error.js";
import { randomUUID } from "node:crypto";
import type { Codex } from "./codex.js";
import type { Store } from "./db.js";
import type { Approval, Json } from "../shared/types.js";
import type { McpServerElicitationRequestResponse } from "../generated/codex/v2/McpServerElicitationRequestResponse.js";
import { isMcpToolConsent } from "../shared/approvals.js";
import {
  INPUT_LIMITS,
  parseInputForm,
  validateInput,
  type InputRequest,
} from "../shared/elicitation.js";
function fail(message: string, statusCode = 400): never {
  throw Object.assign(new PublicError(message), { statusCode });
}
type Pending = InputRequest & { request: Approval };
export function elicitations(
  codex: Codex,
  db: Store,
  expired: (id: string | number, threadId: string) => void,
  decorate: (approval: Approval) => Approval = (approval) => approval,
) {
  const pending = new Map<string | number, Pending>();
  function track(a: Approval) {
    if (
      a.method !== "mcpServer/elicitation/request" ||
      isMcpToolConsent(a) ||
      !db.owns(a.params.threadId)
    )
      return;
    let e = pending.get(a.id);
    if (e?.request !== a) {
      const parsed = parseInputForm(a);
      e = {
        ...parsed,
        token: randomUUID(),
        expiresAt: Date.now() + INPUT_LIMITS.timeoutMs,
        request: a,
      };
      pending.set(a.id, e);
    }
    return e;
  }
  function respond(
    id: string | number,
    token: string,
    decision: "accept" | "decline" | "cancel",
    input?: unknown,
  ) {
    const request = codex.approvals.get(id) as Approval | undefined;
    if (!request || !db.owns(request.params.threadId))
      fail("输入请求已结束或已由其他页面处理", 410);
    const e = track(request);
    if (!e || e.token !== token)
      fail("输入请求已变化，请重新读取当前请求", 410);
    if (e.expiresAt <= Date.now()) {
      expire();
      fail("输入请求已过期并取消", 410);
    }
    if (decision !== "accept" && input !== undefined && input !== null)
      fail("取消或拒绝时不应提交表单内容");
    let content: Json | null = null;
    if (decision === "accept") {
      if (!e.form) fail("此输入请求不受支持，不能提交内容");
      const validated = validateInput(e.form, input);
      if (validated.invalid) fail("表单输入无效，请检查必填项、类型和范围");
      content = validated.content;
    }
    const response: McpServerElicitationRequestResponse = {
      action: decision,
      content,
      _meta: null,
    };
    try {
      codex.respond(id, response);
    } catch {
      fail("输入响应未确认，请重新读取当前请求", 503);
    }
    pending.delete(id);
    db.audit("mcp-input", request.params.threadId, decision);
    return {};
  }
  function expire() {
    for (const [id, e] of pending) {
      if (codex.approvals.get(id) !== e.request) {
        pending.delete(id);
        continue;
      }
      if (e.expiresAt > Date.now()) continue;
      try {
        codex.respond(id, { action: "cancel", content: null, _meta: null });
      } catch {
        codex.offline("输入请求响应通道已断开，请重新连接");
        db.audit("mcp-input", e.request.params.threadId, "expiry-unconfirmed");
        continue;
      }
      pending.delete(id);
      db.audit("mcp-input", e.request.params.threadId, "expired");
      expired(id, e.request.params.threadId);
    }
  }
  function publicApproval(a: Approval): Approval {
    const e = track(a);
    if (!e) return decorate(a);
    const { request: _, ...input } = e;
    return decorate({
      id: a.id,
      method: a.method,
      params: {
        threadId: a.params.threadId,
        turnId: a.params.turnId,
        serverName: String(a.params.serverName || "MCP").slice(0, 160),
        mode: "form",
        elicitation: input,
      },
    });
  }
  const timer = setInterval(expire, 1000);
  timer.unref();
  codex.on("approval", track);
  codex.on("resolved", (id) => pending.delete(id));
  codex.on("status", () => {
    if (codex.state !== "ready") pending.clear();
  });
  codex.on("event", (message) => {
    if (message.method === "serverRequest/resolved")
      pending.delete(message.params.requestId);
    if (message.method === "turn/completed") {
      for (const [id, e] of pending)
        if (
          codex.approvals.get(id) === e.request &&
          e.request.params.threadId === message.params.threadId &&
          e.request.params.turnId === message.params.turn.id
        ) {
          try {
            codex.respond(id, { action: "cancel", content: null, _meta: null });
          } catch {
            codex.offline("输入请求响应通道已断开，请重新连接");
          }
          pending.delete(id);
        }
    }
  });
  return {
    pending,
    publicApproval,
    respond,
    expire,
    list: () => {
      expire();
      return [...codex.approvals.values()]
        .filter((a) => db.owns((a.params as Json).threadId))
        .map(publicApproval);
    },
    close: () => {
      clearInterval(timer);
      pending.clear();
    },
  };
}
