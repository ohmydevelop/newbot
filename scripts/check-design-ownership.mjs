import fs from "node:fs";
const failures = [];
for (const file of ["web/styles.css", "web/plugins.css", "web/shell.css"]) {
  const css = fs.readFileSync(file, "utf8");
  if (
    /\.(?:plugins-modal|extension-tabs|sidebar-plugins|rail-resizer|settings-modal|settings-layout|settings-content)\b/.test(
      css,
    )
  )
    failures.push(`${file}: 旧布局或平行设置样式重新出现`);
}
const tokens = fs.readFileSync("web/tokens.css", "utf8");
for (const value of [
  "--content-width: 752px",
  "--motion-fast: 100ms",
  "--motion-panel: 180ms",
  "--motion-navigation: 300ms",
])
  if (!tokens.includes(value)) failures.push(`旧版设计基线被改变：${value}`);
if (failures.length) throw new Error(failures.join("\n"));
console.log("设置布局单一所有者、旧版关键尺寸与动效基线通过");
