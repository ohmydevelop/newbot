// Only classify known module-loading failures. Never render exception text.
export function resourceLoadFailure(error: unknown) {
  return (
    error instanceof Error &&
    /ChunkLoadError|Loading (?:CSS )?chunk .+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
      `${error.name}: ${error.message}`,
    )
  );
}
