import { App } from "@modelcontextprotocol/ext-apps";
const app = new App(
  { name: "Minimal Agent SDK fixture", version: "1.0.0" },
  {},
);
const root = document.createElement("main");
root.style.cssText = "font:14px system-ui;padding:24px;color:#222";
root.innerHTML =
  '<h2 style="margin:0 0 10px;font-size:18px">SDK 测试应用</h2><p id="value">等待工具结果</p><button style="padding:9px 14px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer">刷新数据</button><p style="font-size:11px;color:#707070">这是测试夹具，并非真实监控数据。</p>';
document.body.append(root);
const value = root.querySelector("#value")!;
app.ontoolresult = (result) => {
  value.textContent = `CPU: ${(result.structuredContent as { cpu: number })?.cpu ?? 25}%`;
};
root.querySelector("button")!.addEventListener("click", () => {
  void app
    .callServerTool({ name: "metrics", arguments: { range: "1h" } })
    .then((result) => {
      value.textContent = `工具交互成功：${JSON.stringify(result.structuredContent || result.content)}`;
    })
    .catch((e) => {
      value.textContent = e.message;
    });
});
await app.connect();
