import { App } from "@modelcontextprotocol/ext-apps";
const app = new App({ name: "资源概览", version: "1" }, {});
document.body.innerHTML =
  '<main style="font:16px system-ui;padding:16px"><h2>资源概览</h2><p id="value"></p><button id="refresh">读取业务组</button><button id="blocked">测试未开放操作</button><p id="result" role="status"></p></main>';
app.ontoolresult = (r) => {
  document.querySelector("#value")!.textContent =
    `当前用量 ${String((r.structuredContent as { cpu?: number })?.cpu)}%`;
};
for (const [id, name] of [
  ["refresh", "list_groups"],
  ["blocked", "danger"],
])
  document.getElementById(id)!.onclick = () => {
    document.getElementById("result")!.textContent = "读取中";
    void app
      .callServerTool({ name, arguments: {} })
      .then(
        (r) =>
          (document.getElementById("result")!.textContent =
            `已读取 ${JSON.stringify(r.structuredContent)}`),
      )
      .catch(
        () =>
          (document.getElementById("result")!.textContent = "本次读取未完成"),
      );
  };
await app.connect();
