import { z } from "zod";
import { gatewayFields } from "./gateways.js";
import { pluginConfigurationSave } from "./plugin-configuration.js";
export const privateField = z.strictObject({
  kind: z.enum(["bearer", "header", "env"]),
  name: z.string().min(1).max(128),
});
export type PrivateField = z.infer<typeof privateField>;
export type PrivateFieldView = {
  revision: string;
  fields: (PrivateField & { stored: boolean })[];
  valid: boolean;
};
export type AuthenticationView = {
  source: "none" | "managed" | "external";
  state: "none" | "saved" | "missing" | "invalid" | "external";
};
export const privateFieldSave = z.strictObject({
  operation: z.literal("credential.fields.save"),
  requestId: z.string().uuid(),
  scope: z.enum(["provider", "mcp"]),
  targetId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  expectedRevision: z.string(),
  expectedFieldsRevision: z.string(),
  fields: z.array(privateField).max(32),
  clearValues: z.boolean().optional(),
  removeFields: z.array(privateField).max(32).optional(),
});
export const privateFieldAuthorize = z.strictObject({
  operation: z.literal("credential.authorize"),
  requestId: z.string().uuid(),
  runId: z.string().uuid(),
  scope: z.enum(["provider", "mcp"]),
  targetId: z.string(),
  expectedFieldsRevision: z.string(),
  duration: z.enum(["run", "thread"]),
});
const probeCreate = z.strictObject({
  requestId: z.string().uuid(),
  operation: z.literal("provider.models.test"),
  providerId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  expectedRevision: z.string().regex(/^cfg1\.[a-f0-9]{64}$/),
});
export const credentialTarget = {
  scope: z.enum(["provider", "mcp"]),
  targetId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  expectedRevision: z.string().regex(/^cfg1\.[a-f0-9]{64}$/),
  expectedVaultVersion: z.string().regex(/^cred1\.[a-f0-9]{64}$/),
};
export const credentialSave = z.strictObject({
  ...credentialTarget,
  operation: z.literal("credential.save"),
  requestId: z.string().uuid(),
  retention: z.enum(["memory", "encrypted"]),
});
export const credentialClear = z.strictObject({
  ...credentialTarget,
  confirm: z.literal(true),
});
export const gatewayCredentialSave = z.strictObject({
  ...gatewayFields,
  operation: z.literal("provider.save"),
  expectedVaultVersion: z
    .string()
    .regex(/^cred1\.[a-f0-9]{64}$/)
    .optional(),
  retention: z.enum(["memory", "encrypted"]),
});
export const credentialCreate = z.discriminatedUnion("operation", [
  pluginConfigurationSave,
  privateFieldSave,
  privateFieldAuthorize,
  probeCreate,
  credentialSave,
  gatewayCredentialSave,
  z.strictObject({
    requestId: z.string().uuid(),
    operation: z.literal("sudo.identity"),
    expectedPolicy: z.string().regex(/^sudo1\.[a-f0-9]{64}$/),
  }),
]);
export type CredentialMetadata = {
  stored?: boolean;
  state:
    | "none"
    | "missing"
    | "binding_changed"
    | "locked"
    | "memory"
    | "encrypted";
  version: string;
  applied: boolean;
  updatedAt: number | null;
};
export type CredentialCreate = z.infer<typeof credentialCreate>;
export type CredentialTicket = {
  id: string;
  operation: CredentialCreate["operation"];
  providerId?: string;
  scope?: "provider" | "mcp";
  targetId?: string;
  retention?: "memory" | "encrypted";
  committed?: boolean;
  applied?: boolean;
  passwordUsed?: boolean;
  receiver?: string;
  message?: string;
  expiresAt: number;
  state:
    | "preparing"
    | "waiting"
    | "checking"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired"
    | "invalidated";
  reason?:
    | "rejected"
    | "redirect"
    | "unavailable"
    | "configuration_changed"
    | "save_unconfirmed";
};
export const credentialPending = (state: CredentialTicket["state"]) =>
  ["preparing", "waiting", "checking"].includes(state);
export function credentialStatus(ticket: CredentialTicket) {
  if (
    ticket.operation === "plugin.configuration.save" ||
    ticket.operation === "credential.fields.save" ||
    ticket.operation === "credential.authorize"
  ) {
    if (ticket.state === "succeeded")
      if (ticket.operation === "plugin.configuration.save")
        return "插件配置已保存，下次任务使用。";
    if (ticket.state === "succeeded")
      return ticket.operation === "credential.fields.save"
        ? "凭证设置已保存，下次任务使用。"
        : "授权已接收，任务将继续。";
    if (ticket.state === "checking") return "正在核对接收方…";
    if (ticket.state === "waiting") return "等待私密输入。";
    if (ticket.state === "failed") return "操作未完成，请读取状态后重试。";
  }
  if (ticket.operation === "sudo.identity") {
    if (ticket.state === "succeeded")
      return ticket.passwordUsed
        ? "单次提权检查成功，执行身份为 root；密码已丢弃。"
        : "单次提权检查成功，系统未要求密码；输入未发送，也未验证密码。";
    if (ticket.state === "checking") return "正在执行单次提权检查…";
    if (ticket.state === "waiting") return "等待私密输入，仅供本次固定操作。";
    if (ticket.state === "failed")
      return "提权检查未完成，可能是密码、系统策略或执行环境不支持。不会自动重试。";
  }
  if (
    ticket.operation === "credential.save" ||
    ticket.operation === "provider.save"
  ) {
    if (ticket.state === "succeeded")
      return ticket.applied
        ? "凭证已保存，下次任务使用，原值无法回读。"
        : "凭证已保存，运行时尚未就绪；请重新连接确认。";
    if (ticket.state === "checking")
      return ticket.committed
        ? "正在写入并重新连接，请等待结果…"
        : "正在核对保存条件…";
    if (ticket.state === "failed")
      return "保存结果未确认，请重新读取实际状态；不会自动重写凭证。";
    if (ticket.state === "waiting") return "等待私密输入，原值不会回显。";
  }
  if (ticket.state === "succeeded")
    return "端点已响应。凭证是否被校验由上游决定，尚未验证模型或工具兼容性。";
  if (ticket.state === "cancelled") return "已取消；已经发送的请求无法撤回。";
  if (ticket.state === "expired") return "私密请求已过期，请重新发起。";
  if (ticket.state === "invalidated")
    return "请求已失效，请重新读取配置后发起。";
  if (ticket.state === "checking") return "正在进行一次连接检查…";
  if (ticket.state === "preparing") return "正在核对接收方…";
  if (ticket.state === "failed")
    return ticket.reason === "rejected"
      ? "上游拒绝了授权，请核对凭证后重新发起。"
      : ticket.reason === "redirect"
        ? "上游要求重定向，已停止发送。请检查服务端端点。"
        : ticket.reason === "configuration_changed"
          ? "配置已变化，凭证未发送。请重新读取配置后发起。"
          : "检查未完成，请核对端点与网络后重新发起；不会自动重发。";
  return "等待输入，凭证仅供本次检查。";
}
