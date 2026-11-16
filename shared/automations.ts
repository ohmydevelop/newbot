import { z } from "zod";
export const scheduleSchema = z
  .object({
    id: z.string().uuid(),
    frequency: z.enum([
      "once",
      "hourly",
      "daily",
      "weekdays",
      "weekly",
      "monthly",
      "yearly",
    ]),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "请选择有效时区"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const d = new Date(v + "T00:00:00Z");
        return (
          Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
        );
      }, "请选择有效日期"),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    until: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .refine(
    (v) => v.frequency !== "weekly" || v.weekdays.length > 0,
    "请选择星期",
  )
  .refine(
    (v) => v.frequency !== "hourly" || (!!v.until && v.until >= v.time),
    "每小时执行的结束时间不能早于开始时间",
  );
export const eventSourceLabels = {
  webhook: "Webhook",
  github: "GitHub",
  hermes: "Hermes",
  openclaw: "OpenClaw",
} as const;
export const eventTriggerSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(["webhook", "github", "hermes", "openclaw"]),
  events: z.array(z.string().trim().min(1).max(100)).max(16).default([]),
  repository: z.string().trim().max(200).default(""),
  actions: z.array(z.string().trim().min(1).max(100)).max(16).default([]),
});
export type AutomationEventTrigger = z.infer<typeof eventTriggerSchema>;
export const automationSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    color: z.enum(["default", "blue", "orange", "green", "red"]).optional(),
    icon: z
      .enum([
        "clock",
        "sun",
        "news",
        "chart",
        "calendar",
        "research",
        "shield",
        "health",
        "language",
      ])
      .optional(),
    prompt: z.string().trim().min(1).max(20000),
    triggers: z.array(scheduleSchema).max(8),
    eventTriggers: z.array(eventTriggerSchema).max(8).default([]),
    provider: z.string().max(200).default(""),
    model: z.string().max(200).default(""),
    effort: z.string().max(40).default(""),
    mode: z.enum(["chat", "plan", "work"]).default("chat"),
    approval: z.enum(["ask", "review", "full"]).default("ask"),
    attachments: z.array(z.string().uuid()).max(8).default([]),
    plugins: z.array(z.string().min(1).max(200)).max(8).default([]),
    skills: z
      .array(
        z.object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .max(8)
      .default([]),
    expertId: z.string().uuid().nullable().default(null),
    notification: z.enum(["app", "email", "both", "none"]).default("app"),
  })
  .refine(
    (v) =>
      v.triggers.length + v.eventTriggers.length > 0 &&
      v.triggers.length + v.eventTriggers.length <= 8,
    "请选择 1–8 个触发器",
  )
  .refine(
    (v) =>
      new Set([...v.triggers, ...v.eventTriggers].map((t) => t.id)).size ===
      v.triggers.length + v.eventTriggers.length,
    "触发器标识不能重复",
  );
export type AutomationInput = z.infer<typeof automationSchema>;
export type AutomationSchedule = z.infer<typeof scheduleSchema>;
export type Automation = AutomationInput & {
  id: string;
  revision: number;
  enabled: boolean;
  nextRun: number | null;
  created: number;
  updated: number;
  threadId?: string | null;
  activeRuns: number;
  unread: number;
};
export type AutomationRun = {
  id: string;
  taskId: string;
  taskRevision: number;
  scheduledAt: number;
  state: string;
  requestId: string;
  threadId: string | null;
  turnId: string | null;
  started: number | null;
  completed: number | null;
  error: string | null;
  read: boolean;
  name: string;
  notification: "app" | "email" | "both" | "none";
  event?: { source: keyof typeof eventSourceLabels; type: string };
  delivery?: { state: string; error: string | null; sent: number | null };
};
export const frequencyLabels = {
  once: "仅一次",
  hourly: "每小时",
  daily: "每天",
  weekdays: "工作日",
  weekly: "每周",
  monthly: "每月",
  yearly: "每年",
};
export const runStateLabels: Record<string, string> = {
  queued: "等待运行",
  dispatching: "正在启动",
  running: "正在运行",
  waiting: "等待你处理",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "执行中断",
  unknown: "结果待确认",
  blocked: "需要处理",
};
export function scheduleLabel(t: AutomationSchedule) {
  if (t.frequency === "hourly")
    return `每小时 ${t.time}–${t.until || t.time}${t.weekdays.length ? " · 周" + t.weekdays.map((d) => "一二三四五六日"[d - 1]).join("、") : ""}`;
  const detail =
    t.frequency === "once"
      ? t.date
      : t.frequency === "weekly"
        ? t.weekdays.map((d) => "一二三四五六日"[d - 1]).join("、")
        : t.frequency === "monthly"
          ? `${Number(t.date.slice(8))}日`
          : t.frequency === "yearly"
            ? `${Number(t.date.slice(5, 7))}月${Number(t.date.slice(8))}日`
            : "";
  return `${frequencyLabels[t.frequency]}${detail ? " " + detail : ""} ${t.time}`;
}

export const notificationLabels = {
  app: "站内通知",
  email: "邮件",
  both: "站内与邮件",
  none: "不通知",
};
export const deliveryLabels: Record<string, string> = {
  queued: "邮件等待发送",
  sending: "邮件正在发送",
  sent: "邮件已交付服务器",
  failed: "邮件发送失败",
  unknown: "邮件投递待确认",
};
