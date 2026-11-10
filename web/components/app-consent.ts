// One visible App decision at a time; already-approved tool executions can overlap.
let owner: symbol | undefined;
export const hasAppConsent = () => owner !== undefined;
export function acquireAppConsent(): (() => void) | undefined {
  if (owner) return;
  const key = Symbol();
  owner = key;
  return () => {
    if (owner === key) owner = undefined;
  };
}
