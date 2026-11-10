import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";

// Product diagnostics accompany, but do not replace, the SDK's standard handshake.
export const APP_HOST_POLICY = {
  version: 1,
  toolAuthorization: "allow-once",
  toolScope: "same-server-and-resource",
  displayModes: ["inline"],
  theme: true,
  resize: true,
  network: false,
  inlineDependenciesOnly: true,
  openLinks: false,
  downloads: false,
  messages: false,
  modelContext: false,
  sampling: false,
  serverResources: false,
  toolDiscovery: false,
  prompts: false,
  logging: false,
} as const;

export function appHostCapabilities(toolCalls: boolean): McpUiHostCapabilities {
  return {
    ...(toolCalls ? { serverTools: {} } : {}),
    sandbox: {
      permissions: {},
      csp: {
        connectDomains: [],
        resourceDomains: [],
        frameDomains: [],
        baseUriDomains: [],
      },
    },
  };
}
export function appHostPolicy(toolCalls: boolean) {
  return {
    ...APP_HOST_POLICY,
    protocolCapabilities: appHostCapabilities(toolCalls),
  };
}

export const APP_HOST_RESTRICTIONS = {
  messages: "当前 Host 未开放发送聊天消息，请直接在聊天输入框中发送。",
  openLinks: "当前 Host 未开放外部链接，未打开任何页面。",
  downloads: "当前 Host 未开放应用下载，未创建任何下载。",
  modelContext: "当前 Host 未开放模型上下文更新，未写入聊天上下文。",
  serverResources: "当前 Host 未开放应用读取额外 MCP 资源。",
  toolDiscovery: "当前 Host 未开放工具目录查询，请查看权限与能力中的工具范围。",
  prompts: "当前 Host 未开放 MCP 提示模板查询。",
  sampling: "当前 Host 未开放应用调用模型，未发起模型请求。",
  displayMode: "当前 Host 仅支持聊天内嵌显示，已保持当前布局。",
  unknown: "当前 Host 不支持此请求，请查看权限与能力。",
} as const;
