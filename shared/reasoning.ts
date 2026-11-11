export const reasoningLabels: Record<string, string> = {
  none: "关闭",
  minimal: "极简",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "Max",
  ultra: "Ultra",
};
export const standardEfforts = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];
type ModelReasoning = {
  supportedReasoningEfforts?: {
    reasoningEffort: string;
    description?: string;
  }[];
  reasoningCapability?: {
    status: "unknown" | "supported";
    source: string;
    provider: string;
    revision: string;
  };
};
export function effortSupport(
  model: ModelReasoning | undefined,
  effort: string,
): "supported" | "unsupported" | "unknown" {
  if (!effort) return "supported";
  const listed = model?.supportedReasoningEfforts?.some(
    (e) => e.reasoningEffort === effort,
  );
  if (model?.reasoningCapability?.status === "supported")
    return listed ? "supported" : "unsupported";
  // Legacy catalog entries with an explicit list retain their native contract.
  if (!model?.reasoningCapability && model?.supportedReasoningEfforts?.length)
    return listed ? "supported" : "unsupported";
  return Object.hasOwn(reasoningLabels, effort) ? "unknown" : "unsupported";
}
export function reasoningOptions(model: ModelReasoning | undefined) {
  return model?.reasoningCapability?.status === "unknown" ||
    !model?.supportedReasoningEfforts?.length
    ? standardEfforts.map((reasoningEffort) => ({
        reasoningEffort,
        description: "网关尚未声明支持情况，选择后按此参数请求",
      }))
    : model.supportedReasoningEfforts;
}
