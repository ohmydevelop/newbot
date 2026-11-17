import { z } from "zod";
import { cloudEvent } from "../../packages/event-bridge/protocol.js";

const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/);
export const manifestSchema = z.strictObject({
  version: z.literal(1),
  pluginId: key,
  source: z.strictObject({
    id: key,
    label: z.string().min(1).max(80),
    adapter: key,
    events: z.array(key).min(1).max(100),
  }),
});
export const eventSchema = z.strictObject({
  id: z.string().min(1).max(200),
  type: key,
  payload: z.record(z.string(), z.json()),
  envelope: cloudEvent.optional(),
});
export const pageSchema = z.strictObject({
  cursor: z.string().max(2048),
  nextPollMs: z.number().int().min(0).max(3600000).optional(),
  receipt: z.string().min(1).max(2048).optional(),
  events: z.array(eventSchema).max(32),
});
export const targetSchema = z.strictObject({
  binding: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  taskId: z.string().uuid(),
  triggerId: z.string().uuid(),
  revision: z.number().int().positive(),
  events: z.array(key).max(32),
});
export const subscriptionSchema = z.strictObject({
  providerId: key,
  connectionId: key,
  resource: z.string().min(1).max(16384),
  targets: z.array(targetSchema).min(1).max(1600),
});
export type SourceEvent = z.infer<typeof eventSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type PullContext = Pick<Subscription, "connectionId" | "resource"> & {
  cursor: string | null;
  signal: AbortSignal;
};
export type PullAdapter = {
  pull(context: PullContext): Promise<z.infer<typeof pageSchema>>;
  acknowledge(context: PullContext, receipt: string): Promise<void>;
};
export {
  SourceFailure,
  canonical,
  hash,
  type FailureCode,
} from "../../packages/event-bridge/core.js";
import { hash } from "../../packages/event-bridge/core.js";
export const targetKey = (t: Target) => hash([t.taskId, t.triggerId]);

export class ProviderRegistry {
  private entries = new Map<
    string,
    {
      manifest: z.infer<typeof manifestSchema>;
      adapter: PullAdapter;
      generation: number;
    }
  >();
  private generation = 0;
  constructor(private adapters: ReadonlyMap<string, PullAdapter>) {}
  registerAdapter(id: string, adapter: PullAdapter) {
    (this.adapters as Map<string, PullAdapter>).set(id, adapter);
  }
  install(input: unknown) {
    const manifest = manifestSchema.parse(input);
    const adapter = this.adapters.get(manifest.source.adapter);
    if (!adapter) throw new Error("Adapter is not registered by the host");
    const id = manifest.pluginId + "/" + manifest.source.id;
    key.parse(id);
    this.entries.set(id, { manifest, adapter, generation: ++this.generation });
    return id;
  }
  get(id: string) {
    return this.entries.get(id);
  }
  alias(id: string, sourceId: string) {
    const source = this.entries.get(sourceId);
    if (!source) throw new Error("Unknown provider");
    this.entries.set(id, source);
    this.entries.delete(sourceId);
  }
  remove(id: string) {
    this.entries.delete(id);
  }
}
