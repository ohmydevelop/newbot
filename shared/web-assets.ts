export function safeAssetPaths(values: unknown): string[] {
  return Array.isArray(values)
    ? [
        ...new Set(
          values.filter(
            (v): v is string =>
              typeof v === "string" &&
              /^assets\/[A-Za-z0-9_./-]+$/.test(v) &&
              !v
                .split("/")
                .some((part) => part === "." || part === ".." || !part),
          ),
        ),
      ].sort()
    : [];
}
// Rebuilding identical assets must not discard the preceding distinct generation.
export function retainedAssets(
  current: string[],
  earlier: string[],
  next: string[],
) {
  const before = safeAssetPaths(current),
    after = safeAssetPaths(next);
  return safeAssetPaths(
    JSON.stringify(before) === JSON.stringify(after)
      ? [...before, ...earlier]
      : before,
  );
}
