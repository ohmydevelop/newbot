import type { PluginListResponse } from "../generated/codex/v2/PluginListResponse.js";
import type { PluginReadResponse } from "../generated/codex/v2/PluginReadResponse.js";
import type { PluginInstallResponse } from "../generated/codex/v2/PluginInstallResponse.js";
import type { ConfigRequirementsReadResponse } from "../generated/codex/v2/ConfigRequirementsReadResponse.js";
import type { ClientRequest } from "../generated/codex/ClientRequest.js";
import type { InitializeResponse } from "../generated/codex/InitializeResponse.js";
import type { ThreadListResponse } from "../generated/codex/v2/ThreadListResponse.js";
import type { ThreadStartResponse } from "../generated/codex/v2/ThreadStartResponse.js";
import type { ThreadResumeResponse } from "../generated/codex/v2/ThreadResumeResponse.js";
import type { ThreadReadResponse } from "../generated/codex/v2/ThreadReadResponse.js";
import type { ThreadTurnsListResponse } from "../generated/codex/v2/ThreadTurnsListResponse.js";
import type { ThreadItemsListResponse } from "../generated/codex/v2/ThreadItemsListResponse.js";
import type { TurnStartResponse } from "../generated/codex/v2/TurnStartResponse.js";
import type { TurnSettingsUpdateResponse } from "../generated/codex/v2/TurnSettingsUpdateResponse.js";
import type { ModelListResponse } from "../generated/codex/v2/ModelListResponse.js";
import type { ConfigReadResponse } from "../generated/codex/v2/ConfigReadResponse.js";
import type { ConfigWriteResponse } from "../generated/codex/v2/ConfigWriteResponse.js";
import type { SkillsListResponse } from "../generated/codex/v2/SkillsListResponse.js";
import type { ListMcpServerStatusResponse } from "../generated/codex/v2/ListMcpServerStatusResponse.js";
import type { McpResourceReadResponse } from "../generated/codex/v2/McpResourceReadResponse.js";
import type { McpServerToolCallResponse } from "../generated/codex/v2/McpServerToolCallResponse.js";
import type { McpServerOauthLoginResponse } from "../generated/codex/v2/McpServerOauthLoginResponse.js";
export type Method = ClientRequest["method"];
export type Params<M extends Method> = Extract<
  ClientRequest,
  { method: M }
>["params"];
export type Results = {
  "plugin/list": PluginListResponse;
  "plugin/read": PluginReadResponse;
  "plugin/install": PluginInstallResponse;
  "configRequirements/read": ConfigRequirementsReadResponse;

  initialize: InitializeResponse;
  "thread/start": ThreadStartResponse;
  "thread/list": ThreadListResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/read": ThreadReadResponse;
  "thread/turns/list": ThreadTurnsListResponse;
  "thread/items/list": ThreadItemsListResponse;
  "turn/start": TurnStartResponse;
  "turn/settings/update": TurnSettingsUpdateResponse;
  "model/list": ModelListResponse;
  "config/read": ConfigReadResponse;
  "config/batchWrite": ConfigWriteResponse;
  "skills/list": SkillsListResponse;
  "mcpServerStatus/list": ListMcpServerStatusResponse;
  "mcpServer/resource/read": McpResourceReadResponse;
  "mcpServer/tool/call": McpServerToolCallResponse;
  "mcpServer/oauth/login": McpServerOauthLoginResponse;
};
export type Result<M extends Method> = M extends keyof Results
  ? Results[M]
  : Record<string, unknown>;

// ts-rs represents native u64 fields as bigint; JSON-RPC transports numbers.
// Keep integers lossless within the range this JS client can round-trip.
export function encodeRpc(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item !== "bigint") return item;
    if (
      item > BigInt(Number.MAX_SAFE_INTEGER) ||
      item < BigInt(Number.MIN_SAFE_INTEGER)
    )
      throw new RangeError("Codex integer exceeds the supported JSON range");
    return Number(item);
  });
}
