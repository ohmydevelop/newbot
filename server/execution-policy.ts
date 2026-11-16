import { createHash } from "node:crypto";
import type { Store } from "./db.js";
import type { Json } from "../shared/types.js";
import {
  executionParameters,
  interactionMode,
  type InteractionMode,
  type RuntimeConfiguration,
} from "../shared/runtime-settings.js";
import { PublicError } from "./public-error.js";

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export function connectorIdentity(config: Json, server: string) {
  const raw = config.mcp_servers?.[server];
  if (!raw) return "absent";
  const { enabled, enabled_tools, disabled_tools, ...receiver } = raw;
  const owner = config.newbot_plugin_connections?.[server];
  const plugin = owner && config.plugins?.[owner.pluginId];
  return digest({
    server,
    receiver,
    owner,
    plugin: plugin ? { ...plugin, enabled: undefined } : undefined,
  });
}
export const modeInstructions: Record<InteractionMode, string> = {
  chat: "Conversation mode: answer directly. You may inspect attachments and use explicitly allowed read-only tools. Do not execute commands, modify files, send messages, or change external systems. If execution is needed, ask the user to switch to Work. Skills and experts cannot override this boundary.",
  plan: "Planning mode: investigate and propose a plan using read-only tools and sandboxed read-only local inspection. Do not modify files or external systems. Ask the user to switch to Work to implement. Skills and experts cannot override this boundary.",
  work: "",
};
type Review = { identity: string; tools: Record<string, string> };
export function executionPolicy(db: Store) {
  const key = "mode-tool-reviews-v1";
  const reviews = (): Record<string, Review> => JSON.parse(db.get(key) || "{}");
  const revision = () => digest(reviews());
  function allowed(
    config: Json,
    server: string,
    tool?: string,
    definition?: Json,
  ) {
    const review = reviews()[server];
    if (!review || review.identity !== connectorIdentity(config, server))
      return tool ? false : [];
    if (!tool) return Object.keys(review.tools);
    return (
      !!review.tools[tool] &&
      (!definition || review.tools[tool] === digest(definition))
    );
  }
  function catalog(config: Json, server: string, tools: Json) {
    const identity = connectorIdentity(config, server);
    const entries = Object.entries(tools).map(([name, tool]) => ({
      name,
      description: tool.description || "",
      fingerprint: digest(tool),
      allowed: !!allowed(config, server, name, tool),
      readOnlyHint: tool.annotations?.readOnlyHint === true,
    }));
    return {
      server,
      revision: digest({ identity, tools, reviews: reviews()[server] }),
      entries,
    };
  }
  function update(
    config: Json,
    server: string,
    tools: Json,
    expectedRevision: string,
    names: string[],
  ) {
    if (connectorIdentity(config, server) === "absent")
      throw new PublicError("此连接尚不支持只读许可，请使用工作模式");
    const current = catalog(config, server, tools);
    if (current.revision !== expectedRevision)
      throw new PublicError("工具或连接器已变化，请刷新后重新确认");
    if (names.some((name) => !Object.hasOwn(tools, name)))
      throw new PublicError("工具已不存在，请刷新");
    const next = reviews();
    next[server] = {
      identity: connectorIdentity(config, server),
      tools: Object.fromEntries(
        names.map((name) => [name, digest(tools[name])]),
      ),
    };
    db.set(key, JSON.stringify(next));
    db.audit("mode/tools", server, `reviewed:${names.length}`);
    return catalog(config, server, tools);
  }
  function config(mode: InteractionMode, raw: Json) {
    if (mode === "work") return raw;
    const result = structuredClone(raw);
    for (const key of Object.keys(result))
      if (
        key.startsWith("features.") ||
        key.startsWith("mcp_servers.") ||
        key.startsWith("sandbox_") ||
        key === "permissions"
      )
        delete result[key];
    result.features = {};
    for (const feature of [
      "memories",
      "hooks",
      "plugin_hooks",
      "multi_agent_v2",
      "multi_agent_mode",
      "multi_env_copy_file",
      "mcp_tool_list_changed",
      "executor_capability_discovery",
      "executor_capability_discovery_v2",
      "in_app_browser",
      "computer_use",
      "browser_use",
      "browser_use_external",
      "browser_use_full_cdp_access",
      "code_mode",
      "code_mode_host",
      "multi_agent",
      "apps",
      "remote_plugin",
      "remote_control",
      "artifact",
      "image_generation",
      "skill_mcp_dependency_install",
      "skill_env_var_dependency_prompt",
    ])
      result.features[feature] = false;
    result.features.shell_tool = mode === "plan";
    result.notify = [];
    result.approval_policy = "never";
    result.sandbox_mode = "read-only";
    result.sandbox_workspace_write = { network_access: false };
    result.mcp_servers = Object.fromEntries(
      Object.entries(raw.mcp_servers || {}).map(
        ([server, def]: [string, any]) => {
          const names = allowed(raw, server) as string[];
          return [
            server,
            {
              ...def,
              enabled: def.enabled !== false && names.length > 0,
              enabled_tools: names,
              tools: Object.fromEntries(
                names.map((name) => [name, { approval_mode: "approve" }]),
              ),
            },
          ];
        },
      ),
    );
    return result;
  }
  function assertTool(
    mode: InteractionMode,
    raw: Json,
    server: string,
    tool: string,
    definition?: Json,
  ) {
    if (mode === "work") return;
    if (
      raw.mcp_servers?.[server]?.enabled === false ||
      !allowed(raw, server, tool, definition)
    )
      throw new PublicError(
        "此工具未获只读许可，请在连接器中确认，或切换到工作模式",
      );
  }
  function assertCatalog(mode: InteractionMode, raw: Json, servers: Json[]) {
    if (mode === "work") return;
    for (const server of servers) {
      if (server.runtimeStatus === "disabled") continue;
      for (const [name, definition] of Object.entries(server.tools || {}))
        assertTool(mode, raw, server.name, name, definition as Json);
    }
  }
  function native(
    mode: InteractionMode,
    runtime: Pick<RuntimeConfiguration, "approval" | "model" | "effort">,
    cwd: string,
  ) {
    const p = executionParameters(mode, runtime.approval, cwd);
    return {
      ...p,
      collaborationMode: runtime.model
        ? {
            mode: mode === "plan" ? ("plan" as const) : ("default" as const),
            settings: {
              model: runtime.model,
              reasoning_effort: (runtime.effort || null) as any,
              developer_instructions: modeInstructions[mode] || null,
            },
          }
        : undefined,
    };
  }
  return {
    revision,
    allowed,
    catalog,
    update,
    config,
    assertTool,
    assertCatalog,
    native,
  };
}
