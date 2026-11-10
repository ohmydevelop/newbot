export const inputSchema = {
  type: "object" as const,
  properties: {
    task_name: {
      type: "string" as const,
      title: "任务名称",
      minLength: 2,
      maxLength: 80,
    },
    server: {
      type: "string" as const,
      title: "测试服务器",
      enum: ["node-a", "node-b"],
      enumNames: ["Node A", "Node B"],
    },
    threshold: {
      type: "integer" as const,
      title: "告警阈值",
      minimum: 10,
      maximum: 100,
      default: 80,
    },
    interval: {
      type: "number" as const,
      title: "采样间隔",
      minimum: 0.5,
      maximum: 60,
      default: 5,
      description: "单位为分钟；这里只测试输入，不创建真实任务。",
    },
    notify: { type: "boolean" as const, title: "发送测试通知", default: false },
    metrics: {
      type: "array" as const,
      title: "监控指标",
      minItems: 1,
      maxItems: 3,
      items: { type: "string" as const, enum: ["CPU", "内存", "磁盘"] },
      default: ["CPU"],
    },
  },
  required: ["task_name", "server", "threshold", "notify", "metrics"],
};
