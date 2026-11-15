import { z } from "zod";

export const pluginConfigurationSave = z.strictObject({
  operation: z.literal("plugin.configuration.save"),
  requestId: z.string().uuid(),
  pluginId: z.string().min(1).max(300),
  connectionId: z.string().regex(/^plugin_[a-f0-9]{32}$/),
  expectedRevision: z.string().min(1).max(100),
  schemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
  values: z.record(
    z.string().max(80),
    z.union([z.string().max(4096), z.number().finite(), z.boolean()]),
  ),
  enabled: z.boolean(),
  caCertificate: z.string().max(43692).nullable().optional(),
  certificateAddress: z.string().max(4096).optional(),
  clearSecrets: z.array(z.string().max(80)).max(32).default([]),
});
export type PluginConfigurationSave = z.infer<typeof pluginConfigurationSave>;
export type PluginConfigField = {
  id: string;
  type: "string" | "number" | "boolean";
  title: string;
  description?: string;
  required: boolean;
  sensitive: boolean;
  min?: number;
  max?: number;
  value?: string | number | boolean;
  stored?: boolean;
};
export type PluginConnection = {
  id: string;
  name: string;
  pluginId: string;
  revision: string;
  schemaDigest: string;
  enabled: boolean;
  configured: boolean;
  transport: "stdio" | "http";
  fields: PluginConfigField[];
  endpointTemplate?: string;
  caCertificate?: string;
  reason?: string;
  reviewRequired?: boolean;
  source: "package";
};
