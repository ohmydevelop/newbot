# 进度

- 已核对共同过滤点及关联默认/历史/手填入口；本轮无需数据迁移。

- U1/U2/U3：已撤销目录及默认保存的用途限制，前端不再以用途将已选模型标为无效。保留能力探针与原生热更新检查。
- 28 项目录、会话运行配置、模型能力测试通过：model-list-unfilter-tests.log。类型检查和完整构建通过：model-list-unfilter-build.log。git diff --check 通过。
- 开发服务完成空闲维护更新：evidence-model-list-unfilter/service/local-update.json。34 线程、107 运行、6 附件及 3 组历史结构保留；凭证、个人/实例配置不变；未创建模型任务。
- 第一次更新与构建结束存在时间重叠，浏览器仍读到旧进程的 21 项目录；发现后在构建确认结束后再次空闲维护重启。未将第一次就绪检查当作完成证据，最终服务 PID 3922600。
- 公网真实浏览器验证：两个网关均恢复 25 项；bge-m3、bge-reranker-v2-m3、general/bge-m3 和 general/bge-reranker-v2-m3 全部显示，已存默认正常选中，不再显示用途无效提示。截图 evidence-model-list-unfilter/models.png。
- 未发起真实模型任务；本轮只撤销展示/选择中的用途限制，保留实际运行时能力和兼容性检查。无未解决阻塞。
