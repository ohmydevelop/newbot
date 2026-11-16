# NB-CERT-08 / NB-UI-09 进度

2026-11-16：完整读取本轮截图、前轮证书记录、CloudWalker 0.6.0 配置/联调文档及实际状态。已落盘计划。已确认保存 pin 与当前证书不同；选择器 flex space-between 是图文分离的代码原因。存在运行中用户任务，未中断、未替换生产服务。

## 已复现保存缺陷与修复

实际浏览器获取系统验证通过的新证书，但普通 pin 变化使 secret binding 变化；提交进入私密通道后被拒绝，界面显示“凭证未保存”。原配置未修改。已在计划补充根因及修复后实施：证书观察颁发服务端短期确认凭据，绑定插件/包/模式/修订/原地址；仅确认的 stdio 环境指纹单字段变化可在原子保存时保留并重封装原 Token。全局凭证绑定算法不放宽，URL/命令/参数/其他 env 变化继续拒绝。成功后前端清除已消费凭据，后续普通保存不会重用旧确认。

针对性测试通过：正确轮换保留秘密、现有任务快照不变、重开恢复；伪造/过期/不可用证书/跨插件/地址变化/其他参数/修改指纹/启动参数/重复使用均拒绝。首轮遗漏观察 ID 返回导致新测试失败，补齐后通过。完整测试 561 通过、1 项因未设置 CODEX_BIN 跳过；随后用生产固定内核单独补跑该项通过，合计 562 项覆盖。构建和类型检查通过。

布局：共享 picker-results 使用固定图标列、弹性文字列、固定勾选列；保留原有视觉，减少行内空白和重复的插件原名/“用于当前会话”。真实浏览器桌面选中前后文字 X 都为 458、图标 X 都为 430，行高 55px；390×844 手机页脚、滚动与按钮可用；搜索后键盘选择成功，技能同类入口检查通过。截图及几何数据在 evidence-cloudwalker-cert-layout。当前未单独验证 200% 浏览器缩放，不将手机结果冒充缩放验收。

## 生产发布与实际业务验收（完成）

产品提交 `f5181b8` 已发布到原生产实例，公网入口保持 https://integration-love-angela-heated.trycloudflare.com/ 。等待原运行任务结束后备份 SQLite、配置和旧构建，才替换构建并重启服务。备份位于生产 `.data/backups/2026-11-16-cloudwalker-cert-layout/`。原生 Codex、Provider、Token 未替换；发布前后数据摘要一致，公网资源哈希与候选构建一致（`deployment.json`）。

真实浏览器重新获取并确认证书，保存成功显示“已保存，下次任务使用”；重新打开配置为 `b1234493…31c00b2`，原 Token 保留。配置 revision `0ecc0ef6-69a6-4846-bab3-2b6eb5e0f1da`。实际 CloudWalker 进程带 Token，pin 与保存值一致（只保存布尔核验，不保存秘密）。证据：`certificate-saved.png`、`certificate-reopened.png`、`runtime-pin.json`。

通过正常聊天界面、真实 deepseek-flash 模型、生产 Codex 与已安装 CloudWalker 0.6.0 调用只读 `summarize_security_posture`，同会话连续两个任务均完成。两次原始 mcpToolCall 记录均 `completed`、error=null，structuredContent.status=`complete`，handling/trend/distribution 均为 `ok`，无 TLS 错误。分别耗时 480ms、542ms。真实结果并非仅依据助手文本；已通过会话读取接口核对原始结构化工具返回。只落盘状态，不存业务统计明细。证据：`live-tool-results.json`、`cloudwalker-live-success.png`、`cloudwalker-live-repeat-success.png`。新会话 ID `01a1e297-3876-7360-955f-d8095ea42f04`。

原截图的生产选择器已核对，图标、标题和类型文字左侧连续排列（`online-picker.png`）。桌面、手机、选中状态与键盘验证使用真实 React 浏览器界面；隔离预览的目录和 Codex 是替身，不用来证明真实业务连通。实际生产工具链证据如上。数据库重开恢复由针对性自动化覆盖；未为重复验证再次重启生产。

## 独立遗留项与验证边界

旧测试会话 `01a1de62-0fb0-7c22-bf30-1fcb76dd4ce4` 在修改前的两份备份中，已经存在 revision=1、state=pending 的下一轮权限/模型设置。尝试发送时显示“下一轮设置应用失败，消息未发送，请重试或撤销设置”，pending 变为 failed，未产生本轮工具调用。其应用失败根因仍待定位，不将它归因于证书，也没有擅自撤销用户设置。独立新会话与后续任务均通过上述真实验收。

关联依据：该旧会话在任务发送之前应用 session_runtime_pending；证书注入与 CloudWalker 调用发生在其后，是不同边界。后续应检查 session-runtime apply 的原生设置异常及回滚、旧 thread resume 的兼容性，并覆盖失败时消息不丢失、一次发送只执行一次。该项不属于本次证书绑定修复，记录为待验证，不能标记解决。

未覆盖 200% 浏览器缩放；已覆盖 390px 手机实际布局。未逐个调用 CloudWalker 全部业务工具；两个真实只读统计调用验证了共享 HTTPS 客户端、配置注入和鉴权链路。未进行任何业务写操作。

## 完成对应关系

- NB-CERT-08 → 旧 pin 与现证书不一致，确认轮换又触发原凭证 binding 不匹配 → stdio 插件配置保存/私密通道/运行快照 → 受约束的证书观察凭据与原子重封装 → 保存、读回、进程和两次原始业务工具结果通过。
- NB-UI-09 → shared picker 的 space-between 推开文字 → 专家/插件/技能共享行 → 固定图标与勾选列，弹性文字列 → 桌面/手机/选中/键盘截图与几何数据通过。

本轮两项修复已上线；旧会话待应用设置失败、200% 缩放为明确遗留/未验证项。
