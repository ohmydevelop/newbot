import type { Failure } from "../shared/failure.js";

/** Classify untrusted native/provider errors; never forward their text or payload. */
export function publicFailure(input: unknown, retrying = false): Failure {
  const error =
    input && typeof input === "object" ? (input as Record<string, any>) : {};
  const info = error.codexErrorInfo;
  const kind =
    typeof info === "string"
      ? info
      : info && typeof info === "object"
        ? Object.keys(info)[0]
        : undefined;
  const statusValue =
    info && typeof info === "object" ? info[kind!]?.httpStatusCode : undefined;
  const text = [error.message, error.additionalDetails]
    .filter((v) => typeof v === "string")
    .map((v) => v.slice(0, 32768))
    .join("\n");
  // Explicit status syntax only; arbitrary numbers in IDs/URLs are not HTTP status.
  const parsedStatus =
    /(?:http(?: status)?|status(?: code)?|httpStatusCode)[\s:="']+(\d{3})\b/i.exec(
      text,
    );
  const n =
    typeof statusValue === "number" ? statusValue : Number(parsedStatus?.[1]);
  const httpStatus =
    Number.isInteger(n) && n >= 400 && n <= 599 ? n : undefined;
  let category = "unknown",
    message = "任务未完成，未取得可识别的错误原因。",
    action = "展开诊断信息，按任务编号检查网关与服务端记录；确认原因后再发送。";
  const select = (c: string, m: string, a: string) => {
    category = c;
    message = m;
    action = a;
  };
  if (
    httpStatus === 402 ||
    /insufficient[ _-]*(?:balance|credits?|funds)|credit balance.*(?:low|exhaust|insufficient)|balance.*(?:not enough|insufficient)|payment[ _-]*required|余额不足|账户欠费|账号欠费/i.test(
      text,
    )
  )
    select(
      "billing",
      "网关账户余额不足或需要付费，模型请求被拒绝。",
      "请检查网关账户余额与账单，充值或切换可用网关后再发送。",
    );
  else if (
    kind === "usageLimitExceeded" ||
    kind === "sessionBudgetExceeded" ||
    /insufficient_quota|quota[ _-]*(?:exceeded|exhausted)|exceeded.*quota|额度(?:不足|用尽|已耗尽)/i.test(
      text,
    )
  )
    select(
      "quota",
      "模型服务的可用额度已耗尽。",
      "请检查网关的额度、预算或账单；额度不足不一定是欠费，也可切换网关。",
    );
  else if (
    httpStatus === 401 ||
    kind === "unauthorized" ||
    /invalid_api_key|authentication_error/i.test(text)
  )
    select(
      "authentication",
      "网关认证失败。",
      "请在网关设置中检查密钥是否正确或已过期，更新后再发送。",
    );
  else if (httpStatus === 403)
    select(
      "permission",
      "网关拒绝了访问请求。",
      "请检查账户与模型权限；仅凭 403 状态不能确定是欠费。",
    );
  else if (httpStatus === 429 || kind === "rateLimitExceeded")
    select(
      "rate_limit",
      "网关请求过于频繁，已触发限流。",
      "请稍后再试，或切换网关；若持续出现，请检查网关限额。",
    );
  else if (
    kind === "contextWindowExceeded" ||
    /context_length_exceeded|context window.*exceed/i.test(text)
  )
    select(
      "context",
      "对话内容超出模型的上下文容量。",
      "请减少输入内容，或选择上下文容量更大的可用模型。",
    );
  else if (
    kind === "modelNotFound" ||
    /model_not_found|unsupported_model/i.test(text)
  )
    select(
      "model",
      "网关无法使用所选模型。",
      "请检查模型是否开放给当前账户，或选择另一个可用模型。",
    );
  else if (
    (httpStatus && httpStatus >= 500) ||
    ["serverOverloaded", "flexUnavailable", "internalServerError"].includes(
      kind || "",
    )
  )
    select(
      "upstream",
      "模型服务暂时不可用。",
      "请稍后再试或切换网关；持续失败时请联系网关提供方。",
    );
  else if (httpStatus === 400 || kind === "badRequest")
    select(
      "request",
      "网关不接受本次模型请求。",
      "请检查模型是否支持当前输入和工具协议；可尝试另一个兼容模型。",
    );
  else if (/certificate|tls|ssl/i.test(text))
    select(
      "tls",
      "连接网关时证书校验失败。",
      "请检查网关地址与服务器证书信任配置。",
    );
  else if (
    [
      "httpConnectionFailed",
      "responseStreamConnectionFailed",
      "responseStreamDisconnected",
      "responseTooManyFailedAttempts",
    ].includes(kind || "") ||
    /timed? ?out|timeout|connection (?:refused|reset)|dns|failed to connect/i.test(
      text,
    )
  )
    select(
      "connection",
      "与模型网关的连接失败或响应中断。",
      "请检查网关地址、网络和服务状态；恢复后再发送。",
    );
  const knownCodes = new Set([
    "contextWindowExceeded",
    "sessionBudgetExceeded",
    "usageLimitExceeded",
    "rateLimitExceeded",
    "flexUnavailable",
    "serverOverloaded",
    "modelNotFound",
    "internalServerError",
    "unauthorized",
    "badRequest",
    "httpConnectionFailed",
    "responseStreamConnectionFailed",
    "responseStreamDisconnected",
    "responseTooManyFailedAttempts",
    "sandboxError",
  ]);
  return {
    category,
    message,
    action,
    ...(httpStatus ? { httpStatus } : {}),
    ...(kind && knownCodes.has(kind) ? { code: kind } : {}),
    ...(retrying ? { retrying: true } : {}),
  };
}
