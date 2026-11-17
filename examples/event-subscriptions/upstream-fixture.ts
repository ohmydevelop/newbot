import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { SourceEvent } from "../../server/event-subscriptions/contracts.js";

export async function upstreamFixture() {
  const events: SourceEvent[] = [];
  const acknowledgments: string[] = [];
  const requests: { method: string; path: string; cursor: string | null }[] =
    [];
  const controls = {
    status: 200,
    ackStatus: 204,
    disconnect: false,
    repeat: false,
    oversized: false,
    redirect: false,
    hang: false,
  };
  const token = "local-experiment-only";
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    requests.push({
      method: req.method!,
      path: url.pathname,
      cursor: url.searchParams.get("cursor"),
    });
    if (req.headers.authorization !== "Bearer " + token) {
      res.writeHead(401).end();
      return;
    }
    if (controls.disconnect) {
      req.socket.destroy();
      return;
    }
    if (controls.hang) return;
    if (url.pathname === "/ack" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (controls.ackStatus === 204) acknowledgments.push(input.receipt);
      res.writeHead(controls.ackStatus).end();
      return;
    }
    if (url.pathname !== "/pull" || req.method !== "GET") {
      res.writeHead(404).end();
      return;
    }
    if (controls.redirect) {
      res.writeHead(302, { location: "/redirect-target" }).end();
      return;
    }
    if (controls.status !== 200) {
      res
        .writeHead(controls.status, { "retry-after": "2" })
        .end("upstream private error");
      return;
    }
    const cursor = url.searchParams.get("cursor");
    res.writeHead(200, { "content-type": "application/json" }).end(
      controls.oversized
        ? "x".repeat(129 * 1024)
        : JSON.stringify({
            cursor: String(events.length),
            receipt: String(events.length),
            events:
              cursor === null
                ? []
                : controls.repeat
                  ? events
                  : events.slice(Number(cursor)),
          }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    events,
    acknowledgments,
    requests,
    controls,
    token,
    endpoint:
      "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/",
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
