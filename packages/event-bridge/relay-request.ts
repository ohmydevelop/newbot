import { Agent, fetch as undiciFetch } from "undici";
import { X509Certificate } from "node:crypto";

export function relayCertificate(input: string) {
  if (Buffer.byteLength(input) > 43692)
    throw new Error("Relay CA exceeds 32 KiB");
  const pattern =
    /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/g;
  const certificates = [...input.matchAll(pattern)];
  if (!certificates.length || input.replace(pattern, "").trim())
    throw new Error("Relay CA must contain only PEM certificates");
  return certificates
    .map((match) => {
      const bytes = Buffer.from(match[1].replace(/\s/g, ""), "base64");
      const cert = new X509Certificate(bytes);
      if (!cert.raw.equals(bytes)) throw new Error("Invalid relay CA encoding");
      return cert.toString().trim();
    })
    .join("\n");
}

export function relayRequest(origin: string, certificate?: string) {
  const allowed = new URL(origin).origin;
  const agent = certificate?.trim()
    ? new Agent({ connect: { ca: relayCertificate(certificate) } })
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
