import { App } from "@modelcontextprotocol/ext-apps";
const app = new App({ name: "Lifecycle SDK fixture", version: "1.0.0" }, {}),
  root = document.createElement("main");
root.style.cssText = "font:14px system-ui;padding:20px";
root.innerHTML =
  '<h2>生命周期测试应用</h2><p id="value">等待原始结果</p><button id="refresh">刷新数据</button><p id="operation" role="status"></p>';
document.body.append(root);
let source = "";
app.ontoolresult = (result) => {
  const data = result.structuredContent as { cpu: number; source: string };
  source = data.source;
  root.querySelector("#value")!.textContent =
    `原始结果 ${source}: CPU ${data.cpu}%`;
};
root.querySelector("#refresh")!.addEventListener("click", () => {
  void app
    .callServerTool({ name: "metrics", arguments: { source, range: "1h" } })
    .then((result) => {
      root.querySelector("#operation")!.textContent =
        `工具交互成功 ${JSON.stringify(result.structuredContent || result.content)}`;
    })
    .catch(() => {
      root.querySelector("#operation")!.textContent = "工具交互未完成";
    });
});
await app.connect();
