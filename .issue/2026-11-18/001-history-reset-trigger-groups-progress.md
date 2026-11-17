# 进度

调查与授权范围已写入计划。当前产品与数据尚未改动。

## 清理完成

实际实例已停止写入后完整备份（路径见backup.json，目录0700，仅本机）。副本演练通过后执行同一脚本：主库53条会话、原生54条会话、5条任务及15条运行记录清空；外键依赖、A2UI、运行快照、相关上传、任务凭证、订阅队列、原生rollout/索引及每会话独立工作区一并处理。共享用户工作目录、模型、专家、其他插件及凭证不删除。

`rehearsal.json` / `reset.json` 记录逐表计数和处理文件；foreign_key_check通过，脚本对保留配置逐行指纹相等断言通过；`configuration-preserved.json` 在卸载事件桥后再次确认模型/私密字段/专家/邮件配置未变化。

使用正式插件卸载接口卸载relay-events，删除对应事件账号；停止且禁用newbot-github-event-bridge/newbot-event-relay-tunnel/newbot-event-relay三个服务。其私密数据及过期环境变量从运行位置清除，原件在备份。`relay-removed.json` 及 `public-empty.json`：公网会话/任务/原生会话均0，只保留GitHub仓库事件来源。

## UI与检查

共享AutomationChoice增加可选group字段，只有触发器调用者提供分组。时间、外部事件、来自插件使用小号次要标题，不可选择；搜索先过滤选项再显示有结果的分组。保持按钮为原来的直接子元素，避免改变原有样式及Tab次序；其他模型/通知/日期选择器没有额外标题。

- build.log / types.log / lint.log / boundaries.log通过。
- unit.log：10项当前事件协议/直收测试通过；清理另在完整真实数据库副本演练，而非仅测试空库。
- browser.log / browser.json：18项通过，320/390/768/1280深浅色、无插件/有插件、分组搜索/无结果、Tab跳过标题、Escape焦点、原有插件和直接接收流程、正常及减少动画。
- 首轮6项失败是测试使用了原Picker没有实现的ArrowDown导航，改用现有Tab路径后通过；没有借此改变产品键盘交互。
- 3张分组截图，查看390深色确认继承原有视觉，菜单内滚动可到插件选项。design-detector仅报告原有紧凑12/13px字号与文档字阶的advisory（包含新标题复用12px）；未为消除提示而重设全局字号。

状态：实际数据清理完成；UI本地完成，待发布及重启后公网复查。不创建线上测试任务或会话以保持清空结果。

## 发布完成

Web实现 `bd21789` 已发布到实际实例，后端产物保持不变。`deployment.json` 对应已验证构建哈希与原公网入口。发布重启后 `public-empty.json` 再次确认主库、原生库、API会话、任务、运行、接收凭证及事件账号全为0。

公网390px浏览器确认三个标题、插件来源滚动可见、搜索隐藏空组、Escape焦点恢复及无横向溢出（public-ui.json、public-grouped-menu.png）。任务首页空状态截图public-empty-tasks.png。未创建任何线上测试会话或任务。

services.json确认主站active，三项专属事件桥服务inactive且disabled；来源目录只剩已安装的GitHub仓库事件。清理、菜单实现、本地验收、发布与公网复查全部完成。备份仅本机保留，不参与运行时恢复；实体手机未测试，浏览器验收为移动视口。
