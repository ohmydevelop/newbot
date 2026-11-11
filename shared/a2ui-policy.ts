import { z } from "zod";

export const A2UI_CATALOG_ID = "newbot:ui/v1";
export const A2UI_RICH_CATALOG_ID = "newbot:ui/v2";
export function a2uiCatalogId(messages: readonly any[]): string {
  return (
    messages.find((m) => m.createSurface)?.createSurface.catalogId ||
    A2UI_CATALOG_ID
  );
}
export const A2UI_LIMITS = Object.freeze({
  bytes: 65_536,
  string: 4096,
  collection: 64,
  keys: 32,
  values: 4096,
  jsonDepth: 16,
  messages: 8,
  components: 64,
  treeDepth: 12,
});
export class A2uiInputError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "A2uiInputError";
  }
}
export function failA2ui(code: string): never {
  throw new A2uiInputError(code);
}
const forbidden = new Set(["__proto__", "constructor", "prototype"]);

// Runs BEFORE Zod or the SDK. The public boundary accepts wire JSON, not arbitrary
// JavaScript objects. This walker also checks trusted SDK snapshots before reuse.
export function assertA2uiBudget(input: unknown) {
  const stack: [unknown, number][] = [[input, 0]];
  let count = 0;
  while (stack.length) {
    const [value, depth] = stack.pop()!;
    if (++count > A2UI_LIMITS.values || depth > A2UI_LIMITS.jsonDepth)
      failA2ui("RESOURCE_LIMIT");
    if (typeof value === "string") {
      if (value.length > A2UI_LIMITS.string) failA2ui("RESOURCE_LIMIT");
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) failA2ui("INVALID_JSON");
    } else if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        if (value.length > A2UI_LIMITS.collection) failA2ui("RESOURCE_LIMIT");
        for (const item of value) stack.push([item, depth + 1]);
      } else {
        if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
          failA2ui("INVALID_JSON");
        let keys = 0;
        for (const key in value) {
          if (!Object.hasOwn(value, key)) continue;
          if (++keys > A2UI_LIMITS.keys || key.length > 256)
            failA2ui("RESOURCE_LIMIT");
          if (forbidden.has(key)) failA2ui("FORBIDDEN_KEY");
          const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
          if (!Object.hasOwn(descriptor, "value")) failA2ui("INVALID_JSON");
          stack.push([descriptor.value, depth + 1]);
        }
      }
    } else if (value !== null && typeof value !== "boolean")
      failA2ui("INVALID_JSON");
  }
}
export function encodeA2ui(input: unknown): string {
  assertA2uiBudget(input);
  const raw = JSON.stringify(input);
  assertA2uiBytes(raw);
  return raw;
}
function assertA2uiBytes(raw: string) {
  if (
    typeof raw !== "string" ||
    raw.length > A2UI_LIMITS.bytes ||
    new TextEncoder().encode(raw).length > A2UI_LIMITS.bytes
  )
    failA2ui("RESOURCE_LIMIT");
}
export function isA2uiPointer(path: string) {
  if (path === "" || path === "/") return true;
  if (path.length > 256 || !path.startsWith("/")) return false;
  const parts = path.slice(1).split("/");
  return (
    parts.length <= 8 &&
    parts.every((part) => {
      if (/~(?![01])/.test(part)) return false;
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      return (
        key.length > 0 &&
        key.length <= 64 &&
        key !== "-" &&
        !forbidden.has(key) &&
        (!/^\d+$/.test(key) ||
          (/^(0|[1-9]\d*)$/.test(key) && Number(key) < A2UI_LIMITS.collection))
      );
    })
  );
}
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const pointer = z.string().refine(isA2uiPointer);
const version = z.literal("v0.9");
export const a2uiEnvelope = z.union([
  z.strictObject({
    version,
    createSurface: z.strictObject({
      surfaceId: id,
      catalogId: z.enum([A2UI_CATALOG_ID, A2UI_RICH_CATALOG_ID]),
    }),
  }),
  z.strictObject({
    version,
    updateComponents: z.strictObject({
      surfaceId: id,
      components: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .max(A2UI_LIMITS.components),
    }),
  }),
  z.strictObject({
    version,
    updateDataModel: z.strictObject({
      surfaceId: id,
      path: pointer.optional(),
      value: z.unknown().optional(),
    }),
  }),
  z.strictObject({ version, deleteSurface: z.strictObject({ surfaceId: id }) }),
]);
export type A2uiMessage = z.infer<typeof a2uiEnvelope>;
export function decodeA2ui(raw: string): A2uiMessage[] {
  assertA2uiBytes(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failA2ui("INVALID_JSON");
  }
  assertA2uiBudget(parsed);
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  if (!messages.length || messages.length > A2UI_LIMITS.messages)
    failA2ui("RESOURCE_LIMIT");
  const result = z.array(a2uiEnvelope).safeParse(messages);
  if (!result.success) failA2ui("INVALID_MESSAGE");
  return result.data;
}
