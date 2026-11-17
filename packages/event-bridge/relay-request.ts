import { Agent, fetch as undiciFetch } from "undici";

export function relayRequest(origin: string, certificate?: string) {
  const allowed = new URL(origin).origin;
  const agent = certificate?.trim()
    ? new Agent({ connect: { ca: certificate } })
    : undefined;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.origin !== allowed) throw new Error("Relay origin changed");
    return (
      agent
        ? await undiciFetch(url, {
            ...init,
            redirect: "error",
            dispatcher: agent,
          } as any)
        : await fetch(input, { ...init, redirect: "error" })
    ) as Response;
  };
  return {
    request,
    close: async () => {
      await agent?.close();
    },
  };
}
