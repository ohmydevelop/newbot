# 控件约定

操作菜单使用 `web/components/ActionMenu.tsx`，图标沿用 Lucide；图标列、文字列和选中标记由组件负责。工具、插件、聊天历史、附件和审批入口遵循同一规范。

```tsx
<ActionMenuContent>
  <ActionMenuItem icon={Settings2} onSelect={openDetails}>
    查看详情
  </ActionMenuItem>
  <ActionMenuItem icon={Trash2} destructive separated onSelect={confirmRemoval}>
    卸载
  </ActionMenuItem>
</ActionMenuContent>
```

- 操作行：14px 字体、18px 图标、44px 高度；面板圆角 20px，内边距 8px，行圆角 12px。实际宽度适应文字和视口。
- 卸载、删除等危险动作单独分组，并使用语义颜色。确认交互及服务端权限继续由原功能负责。
- 主要操作用 `primary`；普通操作用 `secondary`；纯图标操作用 `icon-button`，配有可访问名称和提示。危险确认使用 `primary destructive`。
- 次级按钮、弹窗取消和审批操作共用样式；下载与存储操作也使用 `secondary`。紧凑工具栏保留其适合上下文的尺寸。
- 菜单展开后触发器保留背景；触摸设备目标至少 44px。按钮禁用时不响应悬停样式，键盘焦点保持可见。
- 模型搜索结果使用模型目录布局；动作选择使用操作菜单。第三方应用的 iframe 使用自己的设计与安全边界。

验证：`npm run test:controls-ui`。对比、截图与回归见 [第三轮记录](../.issue/2026-11-09/progress-03.md)。

## 搜索、弹层与布局

- 可搜索内容使用 `PickerContent`（Radix Popover）；操作仍使用 ActionMenu。输入框的附件、插件、技能、模型及审批由一个受控面板状态管理。按钮打开搜索，不改草稿；手动标记按光标位置补全。
- 外部点击、Escape、切换入口和会话都结束对应选择。读取与提交分开计时；迟到结果不能写入新草稿。关闭后仅在用户尚未移向其他控件时返回原焦点，避免快速操作被抢焦点。
- 设置外壳的宽高不依赖标签或数据状态；搜索、工具目录和内容区分别在自己的区域滚动。网关行共用固定动作列，默认状态不使用禁用按钮表达。
- `danger-text` 只表达颜色，禁止加入外边距、内边距或布局。布局由操作区负责；普通按钮圆角 12px。图标按钮、头像和发送按钮保留其适合的形状。
- 导航、通用图标和面板使用中性色；蓝色表示交互，绿/红表示实际成功/危险。未知模型兼容性不伪装成已验证状态或 HTTP 状态码。
- 修改会话设置后使用服务端返回的权威修订号更新本地状态，保留既有消息与应用实例；不要为刷新一个设置重载整段历史。

验证：`npm run test:ui-regression`。隔离候选构建可先用 `npx vite build --outDir .data/issue04-web`，再用 `UI_TEST_CANDIDATE=.data/issue04-web npm run test:ui-regression` 明确选择候选资源；默认验证当前 `dist/web`，避免误测旧候选，不替换共享页面。覆盖重复触发、取消、迟到响应、句中补全、运行边界、拖放、网关列宽及四种视口的深浅主题。见 [第四轮记录](../.issue/2026-11-09/progress-04.md)。
