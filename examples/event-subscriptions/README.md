# 订阅引擎测试夹具

本目录的 loopback-pull、upstream-fixture 和 plugin.json 仅用于订阅引擎单元测试，不是可安装插件接口。

可安装插件使用当前 MCP Events 声明和独立 MCP 服务，参见 [事件桥](../../docs/event-bridge.md) 与 [信箱示例](../mailbox-events/README.md)。完整集成验收运行 `npm run test:event-bridge` 和 `npm run test:event-bridge-ui`。
