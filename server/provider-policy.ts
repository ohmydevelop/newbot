import type { ConfigReadResponse } from "../generated/codex/v2/ConfigReadResponse.js";
export const providerReserved = new Set([
  "openai",
  "ollama",
  "lmstudio",
  "bedrock",
]);
export const providerRecord = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
export function providerUserConfig(response: ConfigReadResponse) {
  if ((response as any).runtimeProviders) return response.config;
  return providerRecord(
    response.layers?.find(
      (l) =>
        l.name.type === "user" && l.name.profile == null && !l.disabledReason,
    )?.config,
  );
}
export function providerEditable(response: ConfigReadResponse, id: string) {
  if (
    !/^[a-z][a-z0-9_-]{0,63}$/.test(id) ||
    providerReserved.has(id) ||
    !Object.hasOwn(
      providerRecord(providerUserConfig(response).model_providers),
      id,
    )
  )
    return false;
  if ((response as any).runtimeProviders) return true;
  return !Object.entries(response.origins || {}).some(
    ([path, info]) =>
      (path === `model_providers.${id}` ||
        path.startsWith(`model_providers.${id}.`)) &&
      info &&
      (info.name.type !== "user" || info.name.profile != null),
  );
}

export function privateProviderReceiver(value: unknown): string | null {
  const p = providerRecord(value);
  if (
    p.wire_api !== "responses" ||
    p.requires_openai_auth ||
    typeof p.base_url !== "string" ||
    p.base_url.length > 2048
  )
    return null;
  try {
    const url = new URL(p.base_url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "") + "/models";
  } catch {
    return null;
  }
}
