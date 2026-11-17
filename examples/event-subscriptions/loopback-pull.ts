import { pageSchema, SourceFailure, type PullAdapter } from "../../server/event-subscriptions/contracts.js";

export function loopbackPullAdapter(
  endpoint: string,
  token: () => string,
): PullAdapter {
  const base = new URL(endpoint);
  if (
    base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error(
      "Experiment adapter only accepts an explicit IPv4 loopback origin",
    );
  async function request(path: string, signal: AbortSignal, body?: unknown) {
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? "GET" : "POST",
      signal,
      redirect: "error",
      headers: {
        authorization: "Bearer " + token(),
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const code =
        response.status === 401 || response.status === 403
          ? "auth_required"
          : response.status === 410
            ? "gap"
            : response.status === 429 || response.status >= 500
              ? "retry"
              : "conflict";
      const retry = response.headers.get("retry-after");
      const delay =
        retry && /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : retry
            ? Date.parse(retry) - Date.now()
            : 1000;
      throw new SourceFailure(
        code,
        Number.isFinite(delay)
          ? Math.max(1000, Math.min(delay, 3600000))
          : 1000,
      );
    }
    return response;
  }
  return {
    async pull(context) {
      const query = new URLSearchParams({
        connection: context.connectionId,
        resource: context.resource,
      });
      if (context.cursor !== null) query.set("cursor", context.cursor);
      const response = await request("/pull?" + query, context.signal);
      const reader = response.body?.getReader();
      if (!reader) throw new SourceFailure("retry");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 128 * 1024) throw new SourceFailure("capacity");
          chunks.push(value);
        }
        try {
          return pageSchema.parse(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
        } catch {
          throw new SourceFailure("conflict");
        }
      } finally {
        await reader.cancel();
      }
    },
    async acknowledge(context, receipt) {
      const response = await request("/ack", context.signal, {
        connection: context.connectionId,
        resource: context.resource,
        receipt,
      });
      await response.body?.cancel();
    },
  };
}
