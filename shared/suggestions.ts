import type { Turn } from "./types.js";

/** Model-authored metadata, never a reason to manufacture local follow-ups. */
export function extractSuggestions(text: string): {
  text: string;
  suggestions: string[];
} {
  // Track Markdown fences so a protocol example inside a code sample stays code.
  const lines = /.*(?:\r?\n|$)/g;
  let fence:
    | {
        marker: string;
        size: number;
        start: number;
        body: number;
        metadata: boolean;
      }
    | undefined;
  for (const match of text.matchAll(lines)) {
    if (!match[0]) continue;
    const line = match[0].replace(/\r?\n$/, "");
    const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
    if (!fence) {
      if (!opening) continue;
      fence = {
        marker: opening[1][0],
        size: opening[1].length,
        start: match.index,
        body: match.index + match[0].length,
        metadata: opening[2].trim().toLowerCase() === "suggestions",
      };
      continue;
    }
    if (
      !opening ||
      opening[1][0] !== fence.marker ||
      opening[1].length < fence.size ||
      opening[2].trim()
    )
      continue;
    // Only the trailing metadata block belongs to this answer. Earlier blocks
    // followed by prose can be examples the user asked us to explain.
    if (fence.metadata && !text.slice(match.index + match[0].length).trim()) {
      return {
        text: text.slice(0, fence.start).trimEnd(),
        suggestions: parse(text.slice(fence.body, match.index)),
      };
    }
    fence = undefined;
  }
  // While streaming, hide protocol data from its opening line. A truncated or
  // malformed block yields no suggestions; it never falls back to templates.
  if (fence?.metadata)
    return { text: text.slice(0, fence.start).trimEnd(), suggestions: [] };
  return { text, suggestions: [] };
}

const generic = new Set([
  "继续展开",
  "给个例子",
  "给一个具体例子",
  "还有别的方案吗",
  "解释这段代码",
  "给一个可直接运行的示例",
  "这段代码有什么潜在问题",
  "把上面几点总结成三条",
  "展开第一点",
]);
const key = (text: string) =>
  text.replace(/[\s?？!！。.,，]+/g, "").toLowerCase();

function parse(raw: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  return validateSuggestions(value);
}

export function validateSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => {
      const normalized = key(item);
      if (
        !normalized ||
        item.length > 64 ||
        generic.has(normalized) ||
        seen.has(normalized)
      )
        return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 3);
}

/** Shared by live, restored and legacy turns; never reuse another turn's data. */
export function turnSuggestions(
  turn: Pick<Turn, "status" | "items">,
): string[] {
  if (turn.status !== "completed") return [];
  const messages = turn.items.filter((item) => item.type === "agentMessage");
  const final =
    messages.findLast((item) => item.phase === "final_answer") ??
    messages.findLast((item) => !item.phase);
  return typeof final?.text === "string"
    ? extractSuggestions(final.text).suggestions
    : [];
}
