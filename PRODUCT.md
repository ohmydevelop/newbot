# newbot

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

用户已确认以日常聊天为主要使用场景，工具与设置按需展开。其他受众未作假设。

## Product Purpose

以 Codex App Server 为唯一 Agent 内核的私有 Web 客户端。支持持续对话，并在需要时使用模型、专家、插件、技能、文件与交互产物。

## Capabilities and Constraints

现有 React + Vite + Fastify 实现。保留会话历史、草稿隔离、发送回执、审批、私密输入、模型与扩展配置、文件预览、MCP Apps、A2UI、浅深色和手机交互。视觉重构不改变协议、持久化格式或权限语义。

## Brand Commitments

保留 newbot 名称。用户于 2026-11-13 明确选择“高度接近 Grok 的布局、配色与交互，保留 newbot 的现有能力”。以 Grok 当前页面作为实测视觉参考，不复制其品牌标志或虚构其专有能力。

## Evidence on Hand

README.md、web/ 源码、tests/issue-preview-server.ts 隔离测试夹具；当前 Grok 页面及本轮采集记录。测试夹具不提供真实模型服务兼容性的证据。

## Product Principles

- 聊天是首要任务，扩展能力可发现且按需展开。
- 运行状态与错误反馈必须真实，不能为了简洁而掩盖。
- 一次发送仅产生一次有效执行，切换会话不丢失草稿。
- 私密输入与普通聊天保持独立边界。
