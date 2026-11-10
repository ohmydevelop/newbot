export type KeyInput = {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};
export function composerEnter(e: KeyInput) {
  return (
    e.key === "Enter" &&
    !e.shiftKey &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.isComposing &&
    e.keyCode !== 229 &&
    !e.repeat &&
    !e.defaultPrevented
  );
}
export function chatShortcut(
  e: KeyInput,
  authenticated: boolean,
  overlay: boolean,
) {
  if (
    !authenticated ||
    overlay ||
    e.defaultPrevented ||
    e.repeat ||
    e.isComposing ||
    e.keyCode === 229 ||
    e.altKey ||
    !(e.ctrlKey || e.metaKey)
  )
    return null;
  if (e.key.toLowerCase() === "k" && !e.shiftKey) return "search";
  if (e.key.toLowerCase() === "o" && e.shiftKey) return "new";
  return null;
}
export function resolveTheme(
  preference: string,
  systemDark: boolean,
): "light" | "dark" {
  return preference === "dark" || (preference !== "light" && systemDark)
    ? "dark"
    : "light";
}
