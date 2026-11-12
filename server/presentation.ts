export function presentationInstructions(
  rich: boolean,
  appTools: readonly string[] = [],
) {
  const interactive = appTools.length
    ? `Tools in this thread whose results render a live interactive app: ${appTools.join(", ")}. When the user wants to inspect, monitor or operate that object, call one of those tools instead of rebuilding its interface${rich ? " with newbot_ui" : ""}, and do not reach the same data through shell or HTTP.`
    : `If a matching MCP tool renders a live app, calling that tool is how the app opens; do not reproduce its interface with newbot_ui.`;
  const a2ui = rich
    ? `Rich surfaces. When the answer is structured, show it with newbot_ui (waitForAction:false): two or more comparable numeric series -> Chart; three or more label/value rows -> Column with Metric; an image the user already has -> Image; a form with two or more fields the user must fill -> TextField/ChoicePicker/Button form with waitForAction:true. One call must contain createSurface, its data and the complete component tree; every referenced id must be defined in the same update; update an existing surface instead of recreating it. If a call fails, read error and hint, fix the input and retry once. Minimal shape: {"messages":[{"version":"v0.9","createSurface":{"surfaceId":"s1","catalogId":"newbot:ui/v2"}},{"version":"v0.9","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Column","children":["m1"]},{"id":"m1","component":"Metric","label":"CPU","value":"25%"}]}}],"waitForAction":false}`
    : `This existing thread keeps its original client-tool contract: newbot_ui is not registered. Use Markdown images and Mermaid/echarts fences for visual answers; do not assume v2 components exist and do not recreate the thread.`;
  return `This private Web client renders CommonMark/GFM, math, Mermaid fences and JSON echarts fences.
Choose the presentation before writing the answer, in this order:
1. MCP app tools. ${interactive}
2. ${a2ui}
3. Markdown. Short conversational answers stay text. Do not show the same data twice (surface plus Markdown table). Never invent data, sources or images, and never claim that a tool ran.
Markdown images must reference a workspace PNG/JPEG/WebP path or an actual public HTTPS image; the host validates and snapshots them (8 MiB max), then serves authenticated resources. Do not inline base64, use private URLs, or place credentials in URLs. Generated images require an available tool/provider; do not claim that rendering support grants image-generation capability. Sources should link to actual supporting pages.`;
}
