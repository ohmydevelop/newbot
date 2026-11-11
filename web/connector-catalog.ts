/** Configuration owns the independent catalog. Discovery only enriches rows;
 * runtime plugin components must never create transient independent entries. */
export function connectorCatalogNames(
  configured: readonly { id: string }[] | undefined,
  pluginNames?: readonly string[],
) {
  return [...new Set(pluginNames ?? configured?.map((m) => m.id) ?? [])];
}
