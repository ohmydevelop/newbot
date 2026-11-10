import { randomUUID } from "node:crypto";
import type { Event } from "@ag-ui/core";
// A bounded transport buffer, not a second event protocol or persistent chat store.
export class EventFeed {
  private epoch = randomUUID();
  private sequence = 0;
  private bytes = 0;
  private rows: { sequence: number; json: string }[] = [];
  constructor(
    private snapshot: () => Event[],
    private maxBytes = 4 * 1024 * 1024,
    private maxEvents = 512,
  ) {}
  push(event: Event) {
    const json = JSON.stringify(event);
    this.rows.push({ sequence: ++this.sequence, json });
    this.bytes += Buffer.byteLength(json);
    while (
      this.rows.length &&
      (this.bytes > this.maxBytes || this.rows.length > this.maxEvents)
    ) {
      this.bytes -= Buffer.byteLength(this.rows.shift()!.json);
    }
  }
  read(cursor?: string, threadId?: string) {
    const [epoch, raw] = cursor?.split(":") || [];
    const sequence = Number(raw);
    const oldest = this.rows[0]?.sequence ?? this.sequence + 1;
    const reset =
      epoch !== this.epoch ||
      !Number.isSafeInteger(sequence) ||
      sequence < oldest - 1 ||
      sequence > this.sequence;
    const events = reset
      ? this.snapshot()
      : this.rows
          .filter((r) => r.sequence > sequence)
          .map((r) => JSON.parse(r.json) as Event);
    return {
      cursor: `${this.epoch}:${this.sequence}`,
      reset,
      events: events.filter((event) => {
        const id =
          event.metadata?.threadId ||
          ("threadId" in event ? event.threadId : undefined);
        return !threadId || !id || id === threadId;
      }),
    };
  }
}
