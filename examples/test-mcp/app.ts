import { App } from "@modelcontextprotocol/ext-apps";
import { outputSchema, type Metrics } from "./model.js";
const app = new App({ name: "Newbot 资源监控实验台", version: "1.0.0" }, {});
const root = document.querySelector<HTMLElement>("#app")!;
root.innerHTML = `<header class="heading"><div><p class="eyebrow">MCP 测试</p><h1>资源监控实验台</h1></div><span class="simulation"><span></span>模拟数据</span></header><p class="intro">用一份看得见的数据，检查工具与界面是否连通。</p><div class="controls"><label>测试服务器<select id="server"><option value="node-a">Node A</option><option value="node-b">Node B</option><option value="node-c">Node C</option></select></label><label>时间范围<select id="range"><option value="15m">最近 15 分钟</option><option value="1h" selected>最近 1 小时</option><option value="6h">最近 6 小时</option></select></label><button id="refresh" type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.6 8a7 7 0 0 1 11.5-3.1L20 8M4 16l2.9 3.1A7 7 0 0 0 18.4 16"/></svg><span>刷新数据</span></button></div><div class="metrics" role="tablist" aria-label="监控指标"><button role="tab" id="cpu-tab" data-metric="cpu" aria-selected="true"><span>CPU</span><strong id="cpu-value">—<small>%</small></strong><span class="metric-caption">处理器使用率</span></button><button role="tab" id="memory-tab" data-metric="memory" aria-selected="false" tabindex="-1"><span>内存</span><strong id="memory-value">—<small>%</small></strong><span class="metric-caption">内存使用率</span></button><button role="tab" id="disk-tab" data-metric="disk" aria-selected="false" tabindex="-1"><span>磁盘</span><strong id="disk-value">—<small>%</small></strong><span class="metric-caption">磁盘使用率</span></button></div><section class="chart-section" role="tabpanel" aria-labelledby="cpu-tab"><div class="chart-heading"><h2 id="chart-title">CPU 使用率</h2><span id="sample-count">等待工具结果</span></div><div class="chart-wrap"><svg id="chart" viewBox="0 0 640 210" role="img" aria-labelledby="chart-description"><title id="chart-description">等待工具返回模拟数据</title></svg></div><div class="range-labels"><span id="range-start">—</span><span id="range-end">—</span></div></section><div id="status" class="status" role="status" aria-live="polite">正在连接 MCP Apps Host…</div><footer><span>全部为测试数据，非真实服务器指标。</span><span>切换指标在本地完成；刷新由宿主授权。</span></footer>`;
const server = root.querySelector<HTMLSelectElement>("#server")!;
const range = root.querySelector<HTMLSelectElement>("#range")!;
const refresh = root.querySelector<HTMLButtonElement>("#refresh")!;
let current: Metrics | undefined;
let metric: "cpu" | "memory" | "disk" = "cpu";
let busy = false;
const names = { cpu: "CPU", memory: "内存", disk: "磁盘" };
const status = root.querySelector<HTMLElement>("#status")!;
function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function render(data: Metrics) {
  current = data;
  server.value = data.server_id;
  range.value = data.range;
  for (const key of ["cpu", "memory", "disk"] as const)
    root.querySelector(`#${key}-value`)!.innerHTML =
      `${data.summary[key]}<small>%</small>`;
  root.querySelector("#chart-title")!.textContent = `${names[metric]}使用率`;
  root.querySelector("#sample-count")!.textContent =
    `24 个采样点 · ${data.server_id.toUpperCase()}`;
  root.querySelector("#range-start")!.textContent = formatTime(
    data.samples[0].at,
  );
  root.querySelector("#range-end")!.textContent = formatTime(
    data.samples.at(-1)!.at,
  );
  const width = 580,
    left = 38,
    top = 12,
    height = 168;
  const points = data.samples
    .map(
      (point, index) =>
        `${left + (index / (data.samples.length - 1)) * width},${top + height * (1 - point[metric] / 100)}`,
    )
    .join(" ");
  const grid = [0, 25, 50, 75, 100]
    .map((value) => {
      const y = top + height * (1 - value / 100);
      return `<line x1="${left}" y1="${y}" x2="${left + width}" y2="${y}" class="grid-line"/><text x="25" y="${y + 4}" text-anchor="end" class="axis-text">${value}</text>`;
    })
    .join("");
  const dots = data.samples
    .map((point, index) => {
      const x = left + (index / (data.samples.length - 1)) * width,
        y = top + height * (1 - point[metric] / 100);
      return `<circle cx="${x}" cy="${y}" r="4" class="sample-point"><title>${formatTime(point.at)} · ${names[metric]} ${point[metric]}%</title></circle>`;
    })
    .join("");
  root.querySelector("#chart")!.innerHTML =
    `<title id="chart-description">${data.server_id} 的模拟${names[metric]}使用率，共 24 个采样点，最新 ${data.summary[metric]}%</title>${grid}<polyline points="${points}" class="series-line"/>${dots}`;
  status.textContent = `已更新 ${formatTime(data.generated_at)} · 第 ${data.refresh_id} 次工具结果`;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")];
  for (const tab of tabs) {
    const selected = tab.dataset.metric === metric;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  root
    .querySelector("[role=tabpanel]")!
    .setAttribute("aria-labelledby", `${metric}-tab`);
}
for (const button of root.querySelectorAll<HTMLButtonElement>("[role=tab]")) {
  button.addEventListener("click", () => {
    metric = button.dataset.metric as typeof metric;
    if (current) render(current);
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const index = tabs.indexOf(button);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    tabs[next].click();
    tabs[next].focus();
  });
}
async function update() {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  server.disabled = true;
  range.disabled = true;
  status.classList.remove("error");
  status.textContent = "等待宿主授权并获取新数据…";
  try {
    const result = await app.callServerTool({
      name: "show_metrics",
      arguments: { server_id: server.value, range: range.value },
    });
    if (result.isError) throw new Error("MCP 工具返回了错误");
    render(outputSchema.parse(result.structuredContent));
  } catch (error) {
    status.classList.add("error");
    status.textContent =
      error instanceof Error ? error.message : "更新失败，请重试";
    if (current) {
      server.value = current.server_id;
      range.value = current.range;
    }
  } finally {
    busy = false;
    refresh.disabled = false;
    server.disabled = false;
    range.disabled = false;
  }
}
refresh.addEventListener("click", () => void update());
server.addEventListener("change", () => void update());
range.addEventListener("change", () => void update());
app.ontoolresult = (result) => {
  try {
    render(outputSchema.parse(result.structuredContent));
  } catch {
    status.classList.add("error");
    status.textContent = "工具结果不符合测试数据格式。";
  }
};
app.ontoolinput = ({ arguments: args }) => {
  if (args?.server_id) server.value = String(args.server_id);
  if (args?.range) range.value = String(args.range);
};
app.onhostcontextchanged = (context) => {
  if (context.theme) document.documentElement.dataset.theme = context.theme;
};
try {
  await app.connect();
  document.documentElement.dataset.theme =
    app.getHostContext()?.theme || "light";
  if (!current) status.textContent = "已连接，等待工具结果…";
} catch (error) {
  status.classList.add("error");
  status.textContent = error instanceof Error ? error.message : "Host 连接失败";
}
