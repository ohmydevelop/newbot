import { Agent, fetch as trustedFetch } from "undici";
import { mcpCertificate } from "./mcp-certificate.js";
import { PublicError } from "./public-error.js";

/** One operation owns its pool. Explicit trust never becomes global or follows redirects. */
export function providerFetcher(definition: Record<string, any>) {
  let agent: Agent | undefined;
  const pem = definition.tls_ca_certificate;
  if (pem) {
    if (!String(definition.base_url).startsWith("https://"))
      throw new PublicError("自定义证书仅支持 HTTPS 模型服务");
    agent = new Agent({
      connect: { ca: mcpCertificate(pem), rejectUnauthorized: true },
    });
  }
  const origin = new URL(definition.base_url).origin;
  return {
    async fetch(url: string, options: RequestInit): Promise<Response> {
      if (!agent) return fetch(url, options);
      if (new URL(url).origin !== origin)
        throw new PublicError("证书不能用于其他模型服务地址");
      return (await trustedFetch(url, {
        ...options,
        redirect: "error",
        dispatcher: agent,
      } as Parameters<typeof trustedFetch>[1])) as unknown as Response;
    },
    async close() {
      await agent?.close();
    },
  };
}
