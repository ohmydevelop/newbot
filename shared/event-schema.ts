import { z } from "zod";

export type EventSchema = {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  title?: string;
  description?: string;
  properties?: Record<string, EventSchema>;
  required?: string[];
  additionalProperties?: false;
  enum?: (string | number | boolean)[];
  items?: EventSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  default?: unknown;
};
const safeKey = (key: string) =>
  /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(key) &&
  !["__proto__", "constructor", "prototype"].includes(key);
export function schemaValidator(input: unknown, depth = 0): z.ZodType {
  const raw = input as EventSchema | null;
  if (
    raw?.properties &&
    Object.keys(raw.properties).some((key) => !safeKey(key))
  )
    throw new Error("配置字段无效");
  if (depth > 4) throw new Error("配置层级过深");
  const s = z
    .strictObject({
      type: z.enum([
        "object",
        "string",
        "number",
        "integer",
        "boolean",
        "array",
      ]),
      title: z.string().max(120).optional(),
      description: z.string().max(1000).optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      required: z.array(z.string()).max(32).optional(),
      additionalProperties: z.literal(false).optional(),
      enum: z
        .array(
          z.union([z.string().max(4096), z.number().finite(), z.boolean()]),
        )
        .min(1)
        .max(100)
        .optional(),
      items: z.unknown().optional(),
      minLength: z.number().int().min(0).max(4096).optional(),
      maxLength: z.number().int().min(0).max(4096).optional(),
      minimum: z.number().finite().optional(),
      maximum: z.number().finite().optional(),
      maxItems: z.number().int().min(0).max(100).optional(),
      default: z.unknown().optional(),
    })
    .parse(input);
  let value: z.ZodType;
  if (s.type === "object") {
    const entries = Object.entries(s.properties || {});
    if (
      entries.length > 32 ||
      entries.some(([key]) => !safeKey(key)) ||
      s.required?.some((key) => !Object.hasOwn(s.properties || {}, key))
    )
      throw new Error("配置字段无效");
    value = z.strictObject(
      Object.fromEntries(
        entries.map(([key, child]) => [
          key,
          s.required?.includes(key)
            ? schemaValidator(child, depth + 1)
            : schemaValidator(child, depth + 1).optional(),
        ]),
      ),
    );
  } else if (s.type === "array") {
    const item = s.items as EventSchema | undefined;
    if (!item || (item.type !== "string" && !item.enum))
      throw new Error("数组字段需要字符串或枚举选项");
    value = z.array(schemaValidator(s.items, depth + 1)).max(s.maxItems ?? 32);
  } else if (s.type === "boolean") value = z.boolean();
  else if (s.type === "string")
    value = z
      .string()
      .min(s.minLength ?? 0)
      .max(s.maxLength ?? 4096);
  else {
    let number = s.type === "integer" ? z.number().int() : z.number().finite();
    if (s.minimum !== undefined) number = number.min(s.minimum);
    if (s.maximum !== undefined) number = number.max(s.maximum);
    value = number;
  }
  if (s.enum)
    value = value.refine(
      (v) => s.enum!.includes(v as string),
      "请选择支持的值",
    );
  return s.default === undefined
    ? value
    : value.default(value.parse(s.default));
}
export function parseEventSchema(input: unknown): EventSchema {
  schemaValidator(input);
  return input as EventSchema;
}
