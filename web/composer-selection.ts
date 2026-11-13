export type MentionToken = {
  kind: "$" | "@";
  query: string;
  start: number;
  end: number;
};
export function mentionAt(
  value: string,
  start: number,
  end = start,
): MentionToken | null {
  if (start !== end || start < 0 || start > value.length) return null;
  // Mentions stay at the start of a line or after whitespace: typing "@" in the
  // middle of prose must remain literal text and never steal keystrokes.
  const match = value.slice(0, start).match(/(?:^|\s)([$@])([^\s$@]*)$/u);
  if (!match) return null;
  const tokenStart = start - match[2].length - 1;
  const suffix = value.slice(start).match(/^[^\s$@]*/u)?.[0] || "";
  return {
    kind: match[1] as "$" | "@",
    query: match[2],
    start: tokenStart,
    end: start + suffix.length,
  };
}
export function removeMention(value: string, token: MentionToken) {
  return value.slice(0, token.start) + value.slice(token.end);
}
