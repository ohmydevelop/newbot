import type { Approval } from "./types";
// Codex represents MCP tool consent as an empty form. This is not a general input form.
export function isMcpToolConsent(approval: Approval): boolean {
  if (approval.method !== "mcpServer/elicitation/request") return false;
  const p = approval.params,
    s = p.requestedSchema;
  return Boolean(
    p.mode === "form" &&
      p._meta?.codex_approval_kind === "mcp_tool_call" &&
      s?.type === "object" &&
      s.properties &&
      typeof s.properties === "object" &&
      !Array.isArray(s.properties) &&
      Object.keys(s.properties).length === 0 &&
      (!s.required || (Array.isArray(s.required) && s.required.length === 0)) &&
      (s.additionalProperties === undefined ||
        s.additionalProperties === false) &&
      Object.keys(s).every((k) =>
        ["type", "properties", "required", "additionalProperties"].includes(k),
      ),
  );
}
