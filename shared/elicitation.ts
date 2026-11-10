import type { Approval } from "./types";
export type InputValue = string | number | boolean | string[];
export type InputField = {
  name: string;
  title: string;
  description?: string;
  required: boolean;
  type: "string" | "number" | "integer" | "boolean" | "enum" | "multi";
  options?: { value: string; label: string }[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
  default?: InputValue;
};
export type InputForm = { message: string; fields: InputField[] };
export type InputRequest = {
  token: string;
  expiresAt: number;
  form?: InputForm;
  issue?: "unsupported" | "sensitive" | "limit";
};
export const INPUT_LIMITS = {
  fields: 12,
  options: 32,
  text: 2000,
  bytes: 16384,
  schemaBytes: 32768,
  timeoutMs: 300000,
} as const;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const bounded = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
// A refusal heuristic for explicit secret requests, never a credential isolation guarantee.
const sensitive = (s: string) =>
  /password|passwd|(?:^|[^a-z])pwd(?:$|[^a-z])|secret|token|api[\s_-]*key|credential|private[\s_-]*key|one[\s_-]*time[\s_-]*(?:code|password)|\botp\b|\bcvv\b|密码|口令|密钥|私钥|凭证|验证码/i.test(
    s,
  );
function options(raw: unknown, titles?: unknown): InputField["options"] {
  if (!Array.isArray(raw) || !raw.length || raw.length > INPUT_LIMITS.options)
    return;
  if (
    titles !== undefined &&
    (!Array.isArray(titles) ||
      titles.length !== raw.length ||
      titles.some((v) => !bounded(v, 160)))
  )
    return;
  const result = raw.map((v, i) =>
    typeof v === "string" && bounded(v, 200)
      ? { value: v, label: (titles as string[] | undefined)?.[i] ?? v }
      : object(v) &&
          keys(v, ["const", "title"]) &&
          bounded(v.const, 200) &&
          bounded(v.title, 160)
        ? { value: v.const, label: v.title }
        : null,
  );
  if (
    result.some((v) => v === null) ||
    new Set(result.map((v) => v?.value)).size !== raw.length
  )
    return;
  return result as NonNullable<InputField["options"]>;
}
function integer(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
}
export function parseInputForm(approval: Approval): {
  form?: InputForm;
  issue?: InputRequest["issue"];
} {
  const p = approval.params;
  if (
    approval.method !== "mcpServer/elicitation/request" ||
    p.mode !== "form" ||
    p._meta?.codex_approval_kind !== undefined
  )
    return { issue: "unsupported" };
  const s: unknown = p.requestedSchema;
  try {
    if (
      new TextEncoder().encode(JSON.stringify(s)).byteLength >
      INPUT_LIMITS.schemaBytes
    )
      return { issue: "limit" };
  } catch {
    return { issue: "unsupported" };
  }
  if (
    !bounded(p.message, 2000) ||
    !object(s) ||
    s.type !== "object" ||
    !object(s.properties) ||
    !keys(s, [
      "type",
      "properties",
      "required",
      "additionalProperties",
      "$schema",
    ]) ||
    (s.additionalProperties !== undefined &&
      s.additionalProperties !== false) ||
    (s.$schema !== undefined && !bounded(s.$schema, 200))
  )
    return { issue: "unsupported" };
  const names = Object.keys(s.properties),
    required = s.required ?? [];
  if (!names.length || names.length > INPUT_LIMITS.fields)
    return { issue: "limit" };
  if (
    !Array.isArray(required) ||
    required.some((v) => typeof v !== "string" || !names.includes(v)) ||
    new Set(required).size !== required.length
  )
    return { issue: "unsupported" };
  if (sensitive(p.message)) return { issue: "sensitive" };
  const fields: InputField[] = [];
  for (const name of names) {
    const v = s.properties[name];
    if (
      !bounded(name, 80) ||
      Object.hasOwn(Object.prototype, name) ||
      name === "prototype" ||
      !object(v) ||
      (v.title !== undefined && !bounded(v.title, 160)) ||
      (v.description !== undefined && !bounded(v.description, 400))
    )
      return { issue: "unsupported" };
    if (sensitive(name + " " + (v.title || "") + " " + (v.description || "")))
      return { issue: "sensitive" };
    const field: InputField = {
      name,
      title: (v.title as string) || name,
      required: required.includes(name),
      type: "string",
      ...(v.description ? { description: v.description as string } : {}),
    };
    const common = ["type", "title", "description", "default"];
    if (
      v.type === "string" &&
      (v.enum !== undefined || v.oneOf !== undefined)
    ) {
      if (
        !keys(v, [...common, "enum", "enumNames", "oneOf"]) ||
        (v.enum !== undefined && v.oneOf !== undefined)
      )
        return { issue: "unsupported" };
      field.type = "enum";
      field.options = options(v.enum ?? v.oneOf, v.enumNames);
      if (!field.options) return { issue: "unsupported" };
    } else if (v.type === "array") {
      if (
        !keys(v, [...common, "items", "minItems", "maxItems"]) ||
        !object(v.items)
      )
        return { issue: "unsupported" };
      const i = v.items;
      if (
        i.anyOf !== undefined
          ? !keys(i, ["anyOf"])
          : i.type !== "string" || !keys(i, ["type", "enum"])
      )
        return { issue: "unsupported" };
      field.type = "multi";
      field.options = options(i.enum ?? i.anyOf);
      if (
        !field.options ||
        (v.minItems !== undefined &&
          !integer(v.minItems, field.options.length)) ||
        (v.maxItems !== undefined && !integer(v.maxItems, field.options.length))
      )
        return { issue: "unsupported" };
      field.minItems = v.minItems as number | undefined;
      field.maxItems = v.maxItems as number | undefined;
      if ((field.minItems || 0) > (field.maxItems ?? field.options.length))
        return { issue: "unsupported" };
    } else if (v.type === "string") {
      if (
        !keys(v, [...common, "minLength", "maxLength", "format"]) ||
        (v.minLength !== undefined &&
          !integer(v.minLength, INPUT_LIMITS.text)) ||
        (v.maxLength !== undefined &&
          !integer(v.maxLength, INPUT_LIMITS.text)) ||
        (v.format !== undefined &&
          !["email", "uri", "date", "date-time"].includes(String(v.format)))
      )
        return { issue: "unsupported" };
      field.minLength = v.minLength as number | undefined;
      field.maxLength =
        (v.maxLength as number | undefined) ?? INPUT_LIMITS.text;
      field.format = v.format as string | undefined;
      if ((field.minLength || 0) > field.maxLength)
        return { issue: "unsupported" };
    } else if (v.type === "number" || v.type === "integer") {
      if (
        !keys(v, [...common, "minimum", "maximum"]) ||
        [v.minimum, v.maximum].some(
          (n) =>
            n !== undefined && (typeof n !== "number" || !Number.isFinite(n)),
        )
      )
        return { issue: "unsupported" };
      field.type = v.type;
      field.minimum = v.minimum as number | undefined;
      field.maximum = v.maximum as number | undefined;
      if (
        field.minimum !== undefined &&
        field.maximum !== undefined &&
        field.minimum > field.maximum
      )
        return { issue: "unsupported" };
    } else if (v.type === "boolean" && keys(v, common)) field.type = "boolean";
    else return { issue: "unsupported" };
    if (v.default !== undefined) {
      if (
        validateInput({ message: "", fields: [field] }, { [name]: v.default })
          .errors[name]
      )
        return { issue: "unsupported" };
      field.default = v.default as InputValue;
    }
    fields.push(field);
  }
  return { form: { message: p.message, fields } };
}
function formatValid(value: string, format?: string): boolean {
  if (!format) return true;
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === "date")
    return (
      /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  if (format === "date-time")
    return (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) &&
      Number.isFinite(Date.parse(value)) &&
      formatValid(value.slice(0, 10), "date")
    );
  try {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
export function validateInput(
  form: InputForm,
  input: unknown,
): {
  errors: Record<string, string>;
  content: Record<string, InputValue>;
  invalid: boolean;
} {
  const errors: Record<string, string> = {},
    content: Record<string, InputValue> = {};
  let invalid = !object(input);
  if (object(input)) {
    try {
      if (
        new TextEncoder().encode(JSON.stringify(input)).byteLength >
        INPUT_LIMITS.bytes
      )
        invalid = true;
    } catch {
      invalid = true;
    }
    if (Object.keys(input).some((k) => !form.fields.some((f) => f.name === k)))
      invalid = true;
    for (const f of form.fields) {
      const v = Object.hasOwn(input, f.name) ? input[f.name] : undefined;
      if (v === undefined) {
        if (f.required) errors[f.name] = "请填写此字段。";
        continue;
      }
      let valid = false;
      if (f.type === "string")
        valid =
          typeof v === "string" &&
          [...v].length >= (f.minLength ?? 0) &&
          [...v].length <= (f.maxLength ?? INPUT_LIMITS.text) &&
          formatValid(v, f.format);
      else if (f.type === "boolean") valid = typeof v === "boolean";
      else if (f.type === "number" || f.type === "integer")
        valid =
          typeof v === "number" &&
          Number.isFinite(v) &&
          (f.type !== "integer" || Number.isSafeInteger(v)) &&
          (f.minimum === undefined || v >= f.minimum) &&
          (f.maximum === undefined || v <= f.maximum);
      else if (f.type === "enum")
        valid =
          typeof v === "string" && !!f.options?.some((o) => o.value === v);
      else if (f.type === "multi")
        valid =
          Array.isArray(v) &&
          v.length >= (f.minItems ?? 0) &&
          v.length <= (f.maxItems ?? f.options!.length) &&
          new Set(v).size === v.length &&
          v.every(
            (x) =>
              typeof x === "string" && f.options?.some((o) => o.value === x),
          );
      if (!valid)
        errors[f.name] =
          f.type === "number" || f.type === "integer"
            ? "请输入范围内的有效数字。"
            : f.type === "multi" || f.type === "enum"
              ? "请选择允许的选项并满足数量要求。"
              : "输入不符合此字段的长度或格式要求。";
      else content[f.name] = v as InputValue;
    }
  }
  return {
    errors,
    content,
    invalid: invalid || Object.keys(errors).length > 0,
  };
}
