import { createServer } from "node:http";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { z } from "zod";
export async function httpMcpFixture(token: string) {
  let toolCalls = 0,
    authorizedRequests = 0;
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    authorizedRequests++;
    const mcp = new McpServer({
      name: "newbot-native-http-test",
      version: "1.0.0",
    });
    mcp.registerTool(
      "safe_probe",
      { description: "Synthetic test only", inputSchema: z.object({}) },
      async () => {
        toolCalls++;
        return { content: [{ type: "text", text: "synthetic" }] };
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await mcp.connect(transport);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const response = await transport.handleRequest(
        new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(["GET", "HEAD"].includes(req.method || "") ? {} : { body }),
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          res.write(next.value);
        }
      }
      res.end();
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    } finally {
      await mcp.close();
    }
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
    get toolCalls() {
      return toolCalls;
    },
    get authorizedRequests() {
      return authorizedRequests;
    },
    async close() {
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
