import type { CloudEvent } from "./protocol.js";
export type SourceEvent = {
  id: string;
  type: string;
  payload: Record<string, any>;
  envelope?: CloudEvent;
};
export type PullContext = {
  connectionId: string;
  resource: string;
  cursor: string | null;
  signal: AbortSignal;
};
export type PullAdapter = {
  pull(
    context: PullContext,
  ): Promise<{
    cursor: string;
    events: SourceEvent[];
    receipt?: string;
    nextPollMs?: number;
  }>;
  acknowledge(context: PullContext, receipt: string): Promise<void>;
};
