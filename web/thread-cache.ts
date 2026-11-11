import type { Thread } from "../shared/types";

/** Presentation snapshots only. Every navigation still reads authoritative state. */
export class ThreadCache {
  private entries = new Map<string, { thread: Thread; bytes: number }>();
  private bytes = 0;
  constructor(
    private limit = 6,
    private maxBytes = 8 * 1024 * 1024,
  ) {}
  remember(thread: Thread | null) {
    if (!thread) return;
    this.remove(thread.id);
    const bytes = JSON.stringify(thread).length * 2;
    if (bytes > this.maxBytes) return;
    this.entries.set(thread.id, { thread, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.limit || this.bytes > this.maxBytes)
      this.remove(this.entries.keys().next().value!);
  }
  get(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.thread;
  }
  remove(id: string) {
    this.bytes -= this.entries.get(id)?.bytes || 0;
    this.entries.delete(id);
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}
