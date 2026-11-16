import { z } from "zod";
export const mailConfigSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  user: z.string().trim().max(320),
  from: z.string().trim().email().max(320),
  to: z.string().trim().email().max(320),
  baseUrl: z
    .string()
    .url()
    .max(2000)
    .refine((v) => {
      const u = new URL(v);
      return (
        ["http:", "https:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }, "请输入不含账号或参数的站点地址"),
  ca: z.string().max(64000).default(""),
});
export type MailConfig = z.infer<typeof mailConfigSchema>;
export type MailSettings = {
  revision: number;
  config: MailConfig | null;
  hasPassword: boolean;
};
