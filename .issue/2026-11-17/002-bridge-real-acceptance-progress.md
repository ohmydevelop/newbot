# AUTO-7F 进度

已核对前轮证据边界、工作树及生产版本。计划先于产品修改落盘。开始隔离安装和 HTTPS 本地环境准备；尚未宣布真实产品集成成功。

## 范围收敛与实现

用户随后取消 OpenClaw/Hermes 兼容。停止隔离安装，删除两套专用示例和构建入口，E2/E3 不再是交付项。下载内容仅在 gitignored 实验目录，未安装全局命令或系统服务。历史兼容测试不保留为当前产品承诺。

E1/E5 共同缺口：发布器和 relay MCP 消费端未提供私有 CA。现在共同使用 packages/event-bridge/relay-request.ts，只允许配置的中继 origin，禁止重定向，保留证书链和主机名校验；relay-events 1.0.1 声明可选 PEM 字段，无平台提供方分支。发布器构建为独立 publisher.mjs。

## 验收结果

- `npm run test:event-bridge`：36/36 通过，包含 TLS、OAuth 本地上游、收据、迁移与订阅边界；types 通过。
- `npm run test:bridge-minimal`：实际 Codex 内核、正式 import/upload/scan/install 服务、HTTPS 反向代理→实际 relay 服务→独立 MCP 进程→自动任务，全链通过。模型为本地确定性 Responses 服务，未声称外部模型服务验收。
- 三次事件对应三次 succeeded run，一个 threadId；中继503时事件留在生产者 SQLite，关闭重开后恢复；重复发布未产生第四次执行；Newbot 重启后恢复账号/任务/游标，第三次仍用原会话。
- Chromium390/1280：真实登录、打开任务运行记录（3条）、进入会话（3条模型结果）及横向溢出检查通过。截图位于 evidence-bridge-real/newbot-*.png、conversation-*.png，全部为隔离合成数据；非真机证据。
- 本地 HTTPS 确实验证证书，未用 -k、rejectUnauthorized:false 或关闭 TLS 环境变量。无 CA/跨源请求均拒绝。
- 验收脚本初次运行发现测试实例需正式资源隔离和精确 origin；按生产初始化方式修正实验装配，未为测试放宽产品权限检查。

完整收据：evidence-bridge-real/receipt.json；回归：regression.txt；TLS：tls.txt；平台边界：boundaries.txt。

发布阶段：待安装生产可选事件插件并记录结果。当前没有生产中继账号或业务事件来源；不将本地验收误写为公网持续运行。生产 WebUI/Server 不需替换，现有平台已支持标准事件插件。

生产首次安装1.0.1成功，公网390/1280均能打开事件源和全部账号字段，无溢出，未保存生产账号/任务。后续检查实际粘贴路径复现PEM换行丢失，已在公共Bridge请求入口进行X509规范化（不改变TLS规则）。1.0.2增加无效/混入私钥/过大证书拒绝、证书链及单行PEM检查；完整原生链路改为保存单行PEM并重启恢复，36项回归和3次同会话执行全部再通过。正在以正式插件升级流程更新生产包。
