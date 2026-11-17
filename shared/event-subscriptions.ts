import { z } from "zod";
import type { EventSchema } from "./event-schema.js";
import type { PluginConfigField } from "./plugin-configuration.js";
export const eventPackageSchema = z.strictObject({
  version: z.literal(2),
  profile: z.literal("mcp-events-47d95c9"),
  sources: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
        label: z.string().min(1).max(80),
        authentication: z.enum(["connection", "oauth"]).default("connection"),
        server: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
      }),
    )
    .min(1)
    .max(8),
});
export const eventAccountSave = z.strictObject({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  providerId: z.string().regex(/^[a-f0-9]{64}$/),
  label: z.string().trim().min(1).max(80),
  reuseConnection: z.boolean().optional(),
  values: z
    .record(
      z.string(),
      z.union([z.string().max(4096), z.number().finite(), z.boolean()]),
    )
    .optional(),
  secrets: z.record(z.string(), z.string().max(4096)).optional(),
});
export type EventProviderView = {
  id: string;
  label: string;
  pluginId: string;
  events: {
    id: string;
    label: string;
    inputSchema?: EventSchema;
    delivery?: string[];
  }[];
  fields?: PluginConfigField[];
  state?: string;
  reusableConnection?: boolean;
  oauth?: boolean;
};
export type EventAccountView = {
  id: string;
  revision: number;
  providerId: string;
  label: string;
  hasToken: boolean;
  available: boolean;
  values?: Record<string, string | number | boolean>;
  secretFields?: string[];
};
export type EventCatalog = {
  providers: EventProviderView[];
  accounts: EventAccountView[];
};
export const subscriptionStateLabels: Record<string, string> = {
  ready: "监听中",
  retry: "正在重连",
  auth_required: "需要重新连接",
  gap: "历史记录不完整",
  capacity: "事件存储已满",
  conflict: "事件格式已变化",
  disabled: "已暂停",
  unavailable: "应用不可用",
  pending: "等待连接",
  baseline: "正在连接",
};
