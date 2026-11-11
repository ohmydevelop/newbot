import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";

// Product diagnostics accompany, but do not replace, the SDK's standard handshake.
export const APP_HOST_POLICY = {
  version: 3,
  toolAuthorization: "conversation-policy-or-allow-once",
  toolScope: "same-server-app-visible",
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
  messages: "应用暂不能发送消息，请在聊天输入框中发送。",
  openLinks: "应用暂不能打开外部链接。",
  downloads: "应用暂不能下载文件。",
  modelContext: "应用暂不能更新对话内容。",
  serverResources: "应用暂不能读取其他资源。",
  toolDiscovery: "应用暂不能查询其他操作。",
  prompts: "应用暂不能读取提示模板。",
  sampling: "应用暂不能向助手发起请求。",
  displayMode: "应用暂不支持切换显示方式。",
  unknown: "应用暂不支持此操作。",
} as const;
