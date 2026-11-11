/** Display metadata is plain text, never an authority or an execution identifier. */
export type ToolDisplay = { serverTitle?: string; toolTitle?: string };
export function displayLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const label = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label ? label.slice(0, 160) : undefined;
}
export function connectorLabel(server: unknown): string {
  const name = displayLabel(server);
  return !name || /^plugin_[a-f0-9]{32}$/.test(name) ? "插件连接器" : name;
}
