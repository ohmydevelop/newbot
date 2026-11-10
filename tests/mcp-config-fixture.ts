import { ConfigCodex, configSecret } from "./config-fixture.js";
import type { Method, Params, Result } from "../server/protocol.js";
export class McpConfigCodex extends ConfigCodex {
  reloads = 0;
  failReload = false;
  failStatus = false;
  states = new Map<string, string>();
  constructor() {
    super();
    this.config.mcp_servers = {
      local: {
        command: `/private/${configSecret}`,
        args: ["--private", configSecret],
        env: { TOKEN: configSecret },
        env_vars: ["EXISTING_MCP_REF"],
        enabled: true,
        startup_timeout_sec: 10,
        tool_timeout_sec: 60,
      },
      remote: {
        url: `https://mcp.example.com/private/${configSecret}?token=${configSecret}`,
        enabled: false,
        bearer_token_env_var: "MCP_TOKEN_REFERENCE",
        http_headers: { Authorization: `Bearer ${configSecret}` },
        env_http_headers: { "X-Token": "MCP_TOKEN_REFERENCE" },
        startup_timeout_sec: 10,
        tool_timeout_sec: 60,
      },
    };
  }
  override async call<M extends Method>(
    method: M,
    params: Params<M>,
  ): Promise<Result<M>> {
    if (method === "config/mcpServer/reload") {
      this.calls.push({ method, params });
      this.reloads++;
      if (this.failReload) throw new Error(configSecret);
      return {} as Result<M>;
    }
    if (method === "mcpServer/oauth/login") {
      this.calls.push({ method, params });
      return {
        authorizationUrl:
          "https://oauth.example.test/authorize?state=synthetic",
      } as Result<M>;
    }
    if (method === "mcpServerStatus/list") {
      this.calls.push({ method, params });
      if (this.failStatus) throw new Error(configSecret);
      const p = params as any;
      const data = Object.entries(this.config.mcp_servers)
        .filter(([id]) => !p.serverName || id === p.serverName)
        .map(([name, raw]) => {
          const def = raw as any,
            state = this.states.get(name) || "ok";
          return {
            name,
            runtimeStatus:
              def.enabled === false
                ? "disabled"
                : state === "failed"
                  ? "failed"
                  : state === "starting"
                    ? "starting"
                    : null,
            pluginId: null,
            httpOrigin: null,
            serverInfo: { name: configSecret },
            serverCapabilities: { private: configSecret },
            toolListMeta: { token: configSecret },
            tools: {
              echo: {
                name: "echo",
                description: configSecret,
                inputSchema: { type: "object" },
              },
            },
            toolsError: state === "failed" ? configSecret : null,
            resources: [],
            resourceTemplates: [],
            authStatus: state === "auth" ? "notLoggedIn" : "unsupported",
          };
        });
      return { data, nextCursor: null } as unknown as Result<M>;
    }
    return super.call(method, params);
  }
}
