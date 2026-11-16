# A7 工作流程滚动竞争

初次全量回归：已设 scrollTop=180，滚轮 +100 后得到100。进一步将“设置scrollTop=180 + 侧栏收起 click”置于同一个浏览器 evaluate（模拟滚动事件交付前的父渲染），旧 dist 稳定返回0，见 /tmp/automation-scroll-before.log。
代码原因：ProcessGroup 的 useLayoutEffect 依赖 items 数组身份，任何父渲染都从尚未更新的 position ref 覆盖DOM。该问题属于旧共享组件；自动任务轮询扩大了触发机会。
修复：只在折叠→展开恢复缓存位置，普通渲染只重新测量边缘；实际流式内容增高由既有 ResizeObserver 执行底部跟随。隐藏期间忽略scroll回调，避免折叠后把缓存改成0。自动任务后台轮询仅在任务状态变化时更新父层，详情局部轮询保留在任务组件，避免无变化数据重绘整个聊天。
验收：tests/browser/interaction-acceptance.spec.ts 的“工作流程默认折叠…”新增同事件断言，同时保留内层滚动、顶部/底部交接、重开原位置检查。最终结果另见进度与 browser evidence。
