import { Agent, fetch as undiciFetch } from "undici";
import { mcpCertificate } from "../mcp-certificate.js";
export function eventRequest(origin: string, certificate?: string) {
  const agent = certificate
    ? new Agent({ connect: { ca: mcpCertificate(certificate) } })
    : undefined;
  const request: typeof fetch = async (input, init) => {
    const address = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    return (
      agent && address.origin === new URL(origin).origin
        ? await undiciFetch(address, { ...init, dispatcher: agent } as any)
        : await fetch(input, init)
    ) as Response;
  };
  return {
    fetch: request,
    close: async () => {
      await agent?.close();
    },
  };
}
