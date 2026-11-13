/**
 * Follow-up prompts travel inside the assistant text as a fenced block so the
 * model can tailor them per answer without a second protocol:
 *
 * ```suggestions
 * ["继续展开", "给个例子"]
 * ```
 *
 * The block is stripped before rendering; anything malformed is ignored and
 * the interface falls back to local heuristics.
 */
const BLOCK = /```suggestions[^\n]*\n([\s\S]*?)```/i;

export function extractSuggestions(text: string): {
  text: string;
  suggestions: string[];
} {
  const match = BLOCK.exec(text);
  if (!match) return { text, suggestions: [] };
  const suggestions = parse(match[1]);
  return {
    text: text.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trimEnd(),
    suggestions,
  };
}

function parse(raw: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0 && item.length <= 64)
    .slice(0, 3);
}
