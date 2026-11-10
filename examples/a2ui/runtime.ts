// D5.1 laboratory only. This module is not imported by the product.
import {
  A2uiMessageSchema,
  MessageProcessor,
  type ActionListener,
  type A2uiMessage,
} from "@a2ui/web_core/v0_9";
import { basicCatalog } from "@a2ui/web_core/v0_9/basic_catalog";
import type { ReactCatalogComponent } from "@a2ui/react/v0_9";
import text from "./official/00_simple-text.json";
import button from "./official/00_interactive-button.json";
import binding from "./official/00_formatted-text.json";
import incremental from "./official/00_incremental.json";

export const samples = {
  text: { label: "文本", ...text },
  button: { label: "按钮操作", ...button },
  binding: { label: "双向绑定", ...binding },
  incremental: { label: "增量更新", ...incremental },
};
export type SampleId = keyof typeof samples;
export type LabVersion = "v0.9" | "v0.9.1";

export function sampleMessages(
  id: SampleId,
  version: LabVersion,
): A2uiMessage[] {
  // Originals remain byte-for-byte intact. The compatibility run changes only
  // the envelope version; the already registered v0.9 catalog ID stays intact.
  return samples[id].messages.map((message) =>
    A2uiMessageSchema.parse({ ...structuredClone(message), version }),
  );
}

export function createLabProcessor(
  version: LabVersion,
  actionHandler?: ActionListener,
) {
  return new MessageProcessor<ReactCatalogComponent>(
    [basicCatalog],
    actionHandler,
    {
      version,
      validationConfig: {
        targetVersion: version,
        allowUnknownElements: false,
        // The official incremental fixture sends forward references in separate
        // messages. Other validation stays enabled; this is not a product policy.
        allowDanglingReferences: true,
        maxDepth: 24,
      },
    },
  );
}

export function applyLabMessage(processor: MessageProcessor, input: unknown) {
  // Use the official envelope schema, then its catalog-aware processor. The
  // envelope alone does not validate component properties or graph structure.
  processor.processMessages(A2uiMessageSchema.parse(input));
}
