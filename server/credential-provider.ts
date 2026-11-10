import { PublicError } from "./public-error.js";
import { request } from "node:https";
import type { CredentialConsumer } from "./credentials.js";
// Fixed GET, Bearer auth only. No existing provider headers, env credentials,
// cookies, proxy credentials, body, redirect, retries, or upstream content.
export function providerCredentialConsumer(
  receiver: string,
  checked: () => Promise<void>,
  ca?: string,
): CredentialConsumer {
  const target = new URL(receiver);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new PublicError("私密操作接收方无效");
  return {
    receiver: target.origin,
    async run(secret, signal, authorized) {
      try {
        await checked();
      } catch {
        return { state: "failed", reason: "configuration_changed" };
      }
      if (!authorized()) return { state: "failed", reason: "unavailable" };
      return new Promise((resolve) => {
        const timeout = AbortSignal.timeout(10_000);
        const abort = AbortSignal.any([signal, timeout]);
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: `Bearer ${secret.toString("ascii")}`,
        };
        let settled = false;
        const done = (value: {
          state: "succeeded" | "failed";
          reason?: "rejected" | "redirect" | "unavailable";
        }) => {
          if (!settled) {
            settled = true;
            delete headers.Authorization;
            resolve(value);
          }
        };
        const req = request(
          receiver,
          { method: "GET", headers, signal: abort, ...(ca ? { ca } : {}) },
          (res) => {
            const code = res.statusCode || 0;
            // Never parse, echo or trace a response which may contain the secret.
            done(
              code >= 200 && code < 300
                ? { state: "succeeded" }
                : {
                    state: "failed",
                    reason: [401, 403].includes(code)
                      ? "rejected"
                      : code >= 300 && code < 400
                        ? "redirect"
                        : "unavailable",
                  },
            );
            res.destroy();
          },
        );
        req.on("error", () => done({ state: "failed", reason: "unavailable" }));
        req.end();
      });
    },
  };
}
