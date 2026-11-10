import { App } from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
const app = new App({ name: "Host policy SDK fixture", version: "1" }, {}),
  root = document.createElement("main");
root.style.cssText = "font:14px system-ui;padding:16px;overflow-wrap:anywhere";
root.innerHTML =
  '<h2>Host 能力测试应用</h2><p id="value">等待结果</p><pre id="capabilities"></pre><pre id="host-context"></pre><div id="actions"></div><pre id="operation" role="status"></pre>';
document.body.append(root);
let source = "";
const output = root.querySelector("#operation")!;
app.ontoolresult = (result) => {
  const data = result.structuredContent as { cpu: number; source: string };
  source = data.source;
  root.querySelector("#value")!.textContent =
    `原始结果 ${source}: CPU ${data.cpu}%`;
};
const requests = {
  message: {
    method: "ui/message",
    params: {
      role: "user",
      content: [{ type: "text", text: "SYNTHETIC_APP_PAYLOAD" }],
    },
  },
  link: {
    method: "ui/open-link",
    params: { url: "https://forbidden.invalid/SYNTHETIC_APP_PAYLOAD" },
  },
  download: {
    method: "ui/download-file",
    params: {
      contents: [
        {
          type: "resource",
          resource: {
            uri: "data:,test",
            mimeType: "text/plain",
            text: "SYNTHETIC_APP_PAYLOAD",
          },
        },
      ],
    },
  },
  context: {
    method: "ui/update-model-context",
    params: { content: [{ type: "text", text: "SYNTHETIC_APP_PAYLOAD" }] },
  },
  resource: {
    method: "resources/read",
    params: { uri: "secret://SYNTHETIC_APP_PAYLOAD" },
  },
  resources: { method: "resources/list", params: {} },
  templates: { method: "resources/templates/list", params: {} },
  prompts: { method: "prompts/list", params: {} },
  tools: { method: "tools/list", params: {} },
  sampling: {
    method: "sampling/createMessage",
    params: { messages: [], maxTokens: 1 },
  },
  unknown: {
    method: "untrusted/SYNTHETIC_APP_PAYLOAD",
    params: { private: "SYNTHETIC_APP_PAYLOAD" },
  },
  fullscreen: {
    method: "ui/request-display-mode",
    params: { mode: "fullscreen" },
  },
  pip: { method: "ui/request-display-mode", params: { mode: "pip" } },
  inline: { method: "ui/request-display-mode", params: { mode: "inline" } },
};
for (const [id, request] of Object.entries(requests)) {
  const button = document.createElement("button");
  button.id = id;
  button.textContent = id;
  button.style.cssText = "min-height:44px;margin:4px";
  button.addEventListener("click", () => {
    output.textContent = "等待处理";
    void app
      .request(request, z.object({}).passthrough(), { timeout: 3000 })
      .then((result) => {
        output.textContent = JSON.stringify({ id, result });
      })
      .catch((error: { code?: number; message?: string; data?: unknown }) => {
        output.textContent = JSON.stringify({
          id,
          error: { code: error.code, message: error.message, data: error.data },
        });
      });
  });
  root.querySelector("#actions")!.append(button);
}
for (const tool of ["metrics", "danger"]) {
  const button = document.createElement("button");
  button.id = tool;
  button.textContent = tool;
  button.addEventListener("click", () => {
    output.textContent = "等待处理";
    void app
      .callServerTool({ name: tool, arguments: { source } })
      .then((result) => {
        output.textContent = JSON.stringify({ id: tool, result });
      })
      .catch(() => {
        output.textContent = JSON.stringify({
          id: tool,
          error: "tool-rejected",
        });
      });
  });
  root.querySelector("#actions")!.append(button);
}
const logging = document.createElement("button");
logging.id = "logging";
logging.textContent = "logging";
logging.addEventListener("click", () => {
  void app
    .notification({
      method: "notifications/message",
      params: { level: "error", data: "SYNTHETIC_APP_PAYLOAD" },
    })
    .then(() => {
      output.textContent = JSON.stringify({ id: "logging", sent: true });
    });
});
root.querySelector("#actions")!.append(logging);
await app.connect();
root.querySelector("#capabilities")!.textContent = JSON.stringify(
  app.getHostCapabilities(),
);
root.querySelector("#host-context")!.textContent = JSON.stringify(
  app.getHostContext(),
);
