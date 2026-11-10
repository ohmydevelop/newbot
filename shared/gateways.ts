import { z } from "zod";
export const gatewayId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const gatewayFields = {
  requestId: z.string().uuid(),
  targetId: gatewayId.optional(),
  expectedRevision: z.string().regex(/^cfg1\.[a-f0-9]{64}$/),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((s) => !/[\x00-\x1f\x7f]/.test(s)),
  baseUrl: z
    .string()
    .max(2048)
    .url()
    .refine((s) => {
      const u = new URL(s);
      return (
        ["https:", "http:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    })
    .optional(),
};
export const gatewaySave = z.strictObject({
  ...gatewayFields,
  action: z.literal("gateway/save").optional(),
});
export const newGatewayId = (requestId: string) =>
  `gateway_${requestId.replaceAll("-", "").toLowerCase()}`;
