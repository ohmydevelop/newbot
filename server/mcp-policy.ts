import type { ConfigReadResponse } from "../generated/codex/v2/ConfigReadResponse.js";
export function mcpEditable(response: ConfigReadResponse, id: string) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) return false;
  const users =
    response.layers?.filter(
      (l) =>
        l.name.type === "user" && l.name.profile == null && !l.disabledReason,
    ) || [];
  if (users.length !== 1) return false;
  const layer = users[0],
    config = layer.config as Record<string, any>;
  if (!config?.mcp_servers || !Object.hasOwn(config.mcp_servers, id))
    return false;
  return !Object.entries(response.origins || {}).some(
    ([path, info]) =>
      (path === "mcp_servers" ||
        path === `mcp_servers.${id}` ||
        path.startsWith(`mcp_servers.${id}.`)) &&
      info &&
      (info.name.type !== "user" ||
        info.name.profile != null ||
        (layer.name.type === "user" && info.name.file !== layer.name.file)),
  );
}
