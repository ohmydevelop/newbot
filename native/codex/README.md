# newbot Codex runtime

基于 OpenAI Codex main 的固定提交开发。精确源码、Rust 工具链及补丁清单见 `manifest.json`；私有源码副本位于 https://github.com/ohmydevelop/newbot-codex 。

原生修改负责两个边界：

- `plugins.<id>.local_root` 固定每轮插件资源目录，仍执行原生启用策略和钩子信任校验。
- `turn/settings/update.modelRoute` 原子发布后续模型请求使用的网关、模型及推理设置。已开始的请求持有旧快照，跨网关创建独立客户端并清除远端响应状态。`turn/settings/applied` 仅在真实请求使用该修订后通知客户端。

Bridge 继续负责鉴权、SQLite 配置、受限凭证注入与任务归属，不承接 Agent loop。原生保留管理策略、Guardian 约束、模型能力和历史兼容检查；缺少完整模型元数据、无法移交的压缩历史及容量不足会明确拒绝，不能以更换显示名称或重建线程替代。

## 构建与验证

在 newbot 根目录运行 `node scripts/build-native-codex.mjs`。脚本从固定上游提交检出独立源码，校验并应用补丁，使用锁文件构建；遇到不属于脚本的已有源码变更会停止，绝不重置个人工作目录。

构建输出 `.data/native/managed/bin/codex` 和包含源码摘要、二进制摘要的 `build.json`。使用该二进制重新生成协议，再运行两组真实内核测试：

```bash
CODEX_BIN="$PWD/.data/native/managed/bin/codex" npm run generate:codex
CODEX_BIN="$PWD/.data/native/managed/bin/codex" node --import tsx scripts/test-issue001-resources-native.mjs
CODEX_BIN="$PWD/.data/native/managed/bin/codex" node --import tsx scripts/test-issue001-live-native.mjs
```

测试使用独立 Codex Home、工作区及模拟 HTTP 网关；不会访问个人 Codex 配置。模拟结果证明协议和状态约束，不证明某个真实网关的兼容性。开发服务需在应用回归通过后再显式选择新二进制。

## 修改协议时

该上游版本将导出协议预编译到 `app-server-protocol/schema/precomputed`。只修改 Rust 类型后直接执行 `generate-ts` 会得到旧类型。先使用上游 `write_schema_fixtures_from_env` 测试入口分别生成 stable 与 experimental 导出，再重新构建二进制、导出 TypeScript 并验证 schema 一致性。生成文件和源代码必须一起提交。

原始 0.167.1 的探针补丁保存在 `patches/`，仅用于追溯；实际构建只使用 manifest 明确列出的 main 补丁。升级上游时更改固定提交，重新验证原生资源、请求路由和恢复，不自动追踪浮动分支。

### 按路由验证的自定义模型（main-0002）

`verifiedModelRoutes` 能力允许可信宿主在 `turn/settings/update.modelRoute` 传入 `verifiedCapabilities`，为目标 Provider / model 指定经实际 Responses 流式 function 调用及结果续接验证的上下文下界和推理参数；旧 Synthetic 模型还需匹配的 `activeCapabilities`。这不是放开任意未知模型：绑定不匹配、容量不足、不支持的历史模态、不可移交的压缩记录以及管理权限冲突仍拒绝更新。

通用模型配置仅声明文本与标准 function 能力，不复制其他模型的视觉、工具模式或最大上下文。已准入任务的 Guardian、node REPL 与审查策略继续保留，普通能力验证不能变更权限。新网关客户端仅作用于后续未开始的模型请求；历史工具不重放。能力结果由 Bridge 按真实有效凭证/端点/模型/推理参数绑定，SQLite 复用最长 24 小时。首次验证会产生额外模型请求，探针不包含用户对话或业务工具。

验证脚本：`scripts/test-model-capabilities-native.mjs`。默认检查两个不在内置目录中的模型；`CAPABILITY_SAME_ID=1` 检查同名跨网关，`CAPABILITY_INITIAL_BUILTIN=1` 检查内置模型转自定义模型并保留原任务约束。均使用隔离目录、模拟网关和真实 App Server，不构成实际商业 Provider 的兼容承诺。
