# NB-V1-G1-DEPS · 依赖发布门槛

2026-11-14，本轮干净安装后的实际 npm audit 发现；尚未修改产品依赖修复。

用户目标：主流官方方案能轻量私有部署，安全边界有效。触发：对精确lab lock执行npm ci/npm audit。实际：936个审计包，37个受影响包记录（24 high/6 moderate/7 low/0 critical）；这不是37个独立漏洞，也不等于所有漏洞均可由当前入口触发。预期：生产启用前定位可达性、兼容修复与剩余风险，不把包知名度或测试通过当安全结论。

不变量：不能用强制安装/框架降级打破已验证的Agent契约，也不能忽略已报告的可达输入风险。证据：evidence-v1/G1/runtime-audit.json、runtime-audit-dry-run.json。非强制`npm audit fix --dry-run`以ERESOLVE失败；没有执行force、legacy-peer或修改锁。

## 按共同机制的风险范围
| 范围 | 状态 | 原因/验证方向 |
|---|---|---|
| Zod约束集合验证，传播到AG-UI/Runtime/A2UI | 有依赖证据，可达性待验证 | 公告GHSA-mrhx-c7xc-m3w5；当前HTTP256KB限额可限制输入但不足以替代补丁验证。沿所有对外schema入口检查，不只chat run |
| Lodash，Apps SDK UI等固定版本 | 有依赖证据，可达性待验证 | template imports注入与unset/omit/pullAt污染；不能把前端控件调用路径未知视为不可达 |
| undici/busboy/graphql-scalars | 有依赖证据，可达性待验证 | 部分为Runtime其他传输/上传/模型适配依赖；列出实际启用Fetch handler与未启用Channels/GraphQL路径，按源码验证后裁剪/兼容升级 |
| KaTeX既有原型污染绕过trust、开发服务器/esbuild | 有依赖证据 | 数学输入和已有污染是不同前置条件；当前sanitizer测试不覆盖供应链公告。esbuild公告涉及Windows开发服务器，本次Linux静态宿主不等于跨平台产品排除 |
| 已部署旧newbot | 未纳入本次变更 | 根package/lock不变；这里的audit结果仅针对lab，不移植为线上既有漏洞结论 |

## 实施顺序
1. 保存当前可复现文本闭环检查点，保持lab仅loopback、不切换生产。
2. 按公告原文/安装包源码核对输入可达性与上游修复版本；记录直接固定版本、兼容范围和需要上游变更的边界。
3. 先尝试满足现有peer约束的精确补丁；禁止自动执行audit建议的大范围框架降级。必要的定点override/供应商补丁必须单独ADR、来源与测试，不能用于掩盖peer冲突。
4. 对变更后的lock重新严格ci、类型/协议/HTTP/渲染与实际模型验证；再审计。未解决的生产可达高风险阻止发布。
5. 与首包约0.83MB gzip的问题共同评估headless/slot和Runtime裁剪；保留唯一CopilotKit，不改成第二Agent框架或模型循环。

验收：明确每项报告是已修复、不可达且有证据、待上游或待验证；不能把audit数量下降当充分证明。输出同目录进度/ADR、精确版本和行为回归。当前未解决：上述漏洞可达性及兼容修复、完整性能预算。它们阻止生产切换，不阻止隔离G1的后续功能研究。
