import { responseJson } from "./http";
import { useApp } from "./store";
import type { CredentialTicket } from "../shared/credentials";
export async function privateApi(
  path: string,
  options?: RequestInit,
): Promise<any> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) useApp.setState({ authenticated: false });
  const result = await responseJson<any>(response);
  if (!response.ok)
    throw new Error(result.error || "私密操作未完成，请重新查询状态。");
  return result;
}
export class PrivateOutcomeUnknown extends Error {
  constructor(readonly ticketId: string) {
    super("私密保存结果未确认，请读取状态；不会自动重复提交。");
  }
}
export async function sendPrivateFields(
  metadata: Record<string, unknown>,
  values: Record<string, string>,
) {
  const id = crypto.randomUUID();
  const ticket: CredentialTicket = await privateApi(
    "/api/credentials/requests",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...metadata, requestId: id }),
    },
  );
  if (ticket.state !== "waiting")
    throw new Error(ticket.message || "接收方已变化，请重新打开设置。");
  // The binary channel is excluded from chat, config, logs and persisted browser state.
  const utf8 = new TextEncoder().encode(JSON.stringify(values));
  const bytes = new TextEncoder().encode(
    btoa(Array.from(utf8, (b) => String.fromCharCode(b)).join("")),
  );
  utf8.fill(0);
  let result: CredentialTicket;
  try {
    result = await privateApi(`/api/credentials/${id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
  } catch {
    try {
      result = await privateApi(`/api/credentials/${id}`);
    } catch {
      throw new PrivateOutcomeUnknown(id);
    }
    if (result.state !== "succeeded") throw new PrivateOutcomeUnknown(id);
  } finally {
    bytes.fill(0);
  }
  if (result.state !== "succeeded")
    throw new Error("凭证未保存，请核对接收方与配置后重试。");
  return result;
}
