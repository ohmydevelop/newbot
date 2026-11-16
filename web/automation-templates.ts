import type {
  AutomationInput,
  AutomationSchedule,
} from "../shared/automations";
export const automationCategories = [
  "全部",
  "新闻",
  "效率",
  "财经",
  "研究",
  "生活",
  "安全",
];
type Template = {
  name: string;
  description: string;
  category: string;
  icon: AutomationInput["icon"];
  prompt: string;
  frequency: AutomationSchedule["frequency"];
  featured?: boolean;
};
export const automationTemplates: Template[] = [
  {
    name: "晨间简报",
    description: "今日要闻、市场动态与天气",
    category: "新闻",
    icon: "sun",
    frequency: "daily",
    featured: true,
    prompt:
      "整理今天的重要新闻、市场变化和我指定城市的天气。注明来源和日期；没有城市或数据时明确说明，不编造。",
  },
  {
    name: "每日行情",
    description: "关注标的的价格、动态与重要事件",
    category: "财经",
    icon: "chart",
    frequency: "daily",
    featured: true,
    prompt:
      "查询我关注标的的最新价格、重要新闻与事件，注明时间和来源。若未指定标的，先询问，不自行推断我的持仓。",
  },
  {
    name: "AI 资讯",
    description: "模型发布、研究进展与行业动态",
    category: "新闻",
    icon: "news",
    frequency: "daily",
    featured: true,
    prompt:
      "汇总过去24小时值得关注的AI模型发布、研究成果与行业动态，优先官方来源，附链接并避免重复报道。",
  },
  {
    name: "今日计划",
    description: "从日历和待办整理今天的安排",
    category: "效率",
    icon: "calendar",
    frequency: "daily",
    featured: true,
    prompt:
      "只读取已授权的日历和待办，整理今天的会议、优先事项和可用专注时间。缺少连接器时说明缺口，不创建或修改日程。",
  },
  {
    name: "每周回顾",
    description: "本周进展、未完事项与下周重点",
    category: "效率",
    icon: "calendar",
    frequency: "weekly",
    featured: true,
    prompt:
      "回顾本周的进展、尚未完成的事项和下周重点。只查询已允许的资料，不修改数据。",
  },
  {
    name: "新闻追踪",
    description: "持续关注你指定的话题",
    category: "新闻",
    icon: "news",
    frequency: "daily",
    prompt:
      "追踪我指定话题的最新进展，区分事实与观点，提供日期及来源。若没有指定话题，先询问。",
  },
  {
    name: "邮件摘要",
    description: "归纳重要邮件和需要回复的事项",
    category: "效率",
    icon: "calendar",
    frequency: "daily",
    prompt:
      "只读取已授权邮箱的近期重要邮件，归纳主题、截止时间与需要我处理的事项。不要发送邮件；没有邮箱连接器时说明如何补齐。",
  },
  {
    name: "待办提取",
    description: "从近期消息中找出行动项",
    category: "效率",
    icon: "calendar",
    frequency: "daily",
    prompt:
      "从已授权的近期消息中提取行动项、负责人和截止时间；缺失的信息标注待确认。不要创建或修改外部任务。",
  },
  {
    name: "财报日历",
    description: "本周财报时间与值得关注的变化",
    category: "财经",
    icon: "chart",
    frequency: "weekly",
    prompt:
      "根据我指定的公司整理本周财报日历，注明时间、来源与值得关注的指标。未指定公司时先询问；不推断我的持仓。",
  },
  {
    name: "竞品追踪",
    description: "产品发布、定价和团队变化",
    category: "研究",
    icon: "research",
    frequency: "weekly",
    prompt:
      "根据我指定的竞品整理本周公开的产品发布、定价变化和团队动态，附原始来源，无依据的内容不作结论。",
  },
  {
    name: "论文追踪",
    description: "研究进展与通俗解读",
    category: "研究",
    icon: "research",
    frequency: "weekly",
    prompt:
      "汇总我指定领域本周重要研究论文，用通俗语言说明问题、方法、结果与局限，并附论文链接。领域未指定时先询问。",
  },
  {
    name: "每周专题",
    description: "围绕一个主题生成研究简报",
    category: "研究",
    icon: "research",
    frequency: "weekly",
    prompt:
      "围绕我指定的主题整理一份研究简报，包含新进展、关键证据、不同观点和待验证问题，注明来源。",
  },
  {
    name: "运动计划",
    description: "按目标安排每天的训练",
    category: "生活",
    icon: "health",
    frequency: "daily",
    prompt:
      "根据我提供的训练目标、经验、可用器材与身体限制，建议今天的运动安排。信息不足先询问，出现不适应停止并咨询专业人员。",
  },
  {
    name: "每周菜单",
    description: "一周晚餐与合并采购清单",
    category: "生活",
    icon: "health",
    frequency: "weekly",
    prompt:
      "根据我指定的人数、饮食偏好、过敏限制与预算安排一周晚餐，并合并采购清单。关键限制缺失先询问。",
  },
  {
    name: "语言练习",
    description: "词汇、语法与短篇翻译",
    category: "生活",
    icon: "language",
    frequency: "daily",
    prompt:
      "根据我指定的语言与程度设计一次短练习：词汇、一个语法点和短篇翻译，先出题后提供答案。语言或程度缺失先询问。",
  },
  {
    name: "安全巡检",
    description: "近期告警、影响范围与核查建议",
    category: "安全",
    icon: "shield",
    frequency: "weekdays",
    prompt:
      "查询已连接安全平台的近期告警，汇总严重程度、影响范围及建议核查项。只读取，不执行处置。",
  },
];
