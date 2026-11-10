import { useSyncExternalStore } from "react";
type Theme = "light" | "dark";
let current: Theme = "light";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function publishAppearance(theme: Theme) {
  if (current === theme) return;
  current = theme;
  for (const listener of listeners) listener();
}
export function useResolvedTheme() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "light" as const,
  );
}
