import { eventRequest } from "./tls.js";
import { randomBytes } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/client";
import type { Store } from "../db.js";
import type { credentialVault } from "../credential-vault.js";
import { PublicError } from "../public-error.js";

type Identity = {
  id: string;
  binding: string;
  generation: number;
  url: string;
  caCertificate?: string;
  clientId?: string;
  scopes?: string[];
};
export function eventOAuth(
  db: Store,
  vault: Pick<
    ReturnType<typeof credentialVault>,
    "sealPrivate" | "openPrivate"
  >,
  identity: (id: string) => Identity,
  callback: string,
) {
  const pending = new Map<
    string,
    { id: string; binding: string; generation: number; expires: number }
  >();
  const context = (i: Identity) =>
    `event-oauth:${i.id}:${i.binding}:${i.generation}`;
  function provider(
    i: Identity,
    onRedirect?: (url: string) => void,
    state?: string,
  ): OAuthClientProvider {
    const check = () => {
      const current = identity(i.id);
      if (context(current) !== context(i) || current.url !== i.url)
        throw new PublicError("连接已变化，请重新授权");
    };
    const read = () => {
      check();
      const row = db.raw
        .prepare("SELECT binding,packet FROM automation_event_oauth WHERE id=?")
        .get(i.id);
      if (!row || row.binding !== context(i)) return {} as any;
      const bytes = vault.openPrivate(row.packet as string, context(i));
      try {
        return JSON.parse(bytes.toString());
      } finally {
        bytes.fill(0);
      }
    };
    const save = (patch: Record<string, unknown>) => {
      const data = { ...read(), ...patch };
      const bytes = Buffer.from(JSON.stringify(data));
      try {
        db.raw
          .prepare(
            "INSERT INTO automation_event_oauth VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET binding=excluded.binding,packet=excluded.packet",
          )
          .run(i.id, context(i), vault.sealPrivate(bytes, context(i)));
      } finally {
        bytes.fill(0);
      }
    };
    return {
      redirectUrl: callback,
      clientMetadata: {
        redirect_uris: [callback],
        client_name: "Newbot Event Bridge",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(i.scopes?.length ? { scope: i.scopes.join(" ") } : {}),
      },
      state: () => state || randomBytes(32).toString("base64url"),
      clientInformation: () =>
        read().client || (i.clientId ? { client_id: i.clientId } : undefined),
      saveClientInformation: (client) => save({ client }),
      tokens: () => read().tokens,
      saveTokens: (tokens) => save({ tokens }),
      saveCodeVerifier: (verifier) => save({ verifier }),
      codeVerifier: () => {
        const value = read().verifier;
        if (!value) throw new PublicError("授权已过期，请重新开始");
        return value;
      },
      redirectToAuthorization: (url) => {
        if (!onRedirect) throw new PublicError("请重新连接账号");
        onRedirect(url.href);
      },
      saveDiscoveryState: (discovery) => save({ discovery }),
      discoveryState: () => read().discovery,
      invalidateCredentials: (scope) => {
        const data = read();
        if (scope === "all")
          save({
            tokens: undefined,
            client: undefined,
            verifier: undefined,
            discovery: undefined,
          });
        else
          save({
            [scope === "client"
              ? "client"
              : scope === "verifier"
                ? "verifier"
                : "tokens"]: undefined,
          });
      },
    };
  }
  return {
    provider: (id: string) => provider(identity(id)),
    async start(id: string) {
      const i = identity(id),
        state = randomBytes(32).toString("base64url");
      for (const [key, item] of pending)
        if (item.id === id || item.expires < Date.now()) pending.delete(key);
      if (pending.size >= 100)
        throw new PublicError("授权请求过多，请稍后重试");
      pending.set(state, {
        id,
        binding: i.binding,
        generation: i.generation,
        expires: Date.now() + 600000,
      });
      let url = "";
      const request = eventRequest(i.url, i.caCertificate);
      try {
        const result = await auth(
          provider(
            i,
            (v) => {
              url = v;
            },
            state,
          ),
          {
            serverUrl: i.url,
            forceReauthorization: true,
            fetchFn: request.fetch,
          },
        );
        if (result === "AUTHORIZED") pending.delete(state);
        return { url, authorized: result === "AUTHORIZED" };
      } catch (error) {
        pending.delete(state);
        throw new PublicError("无法开始授权，请检查连接配置", { cause: error });
      } finally {
        await request.close();
      }
    },
    async complete(query: {
      state?: string;
      code?: string;
      error?: string;
      iss?: string;
    }) {
      const state = query.state || "",
        item = pending.get(state);
      pending.delete(state);
      if (!item || item.expires < Date.now())
        throw new PublicError("授权已过期，请重新开始");
      const i = identity(item.id);
      if (i.binding !== item.binding || i.generation !== item.generation)
        throw new PublicError("连接已变化，请重新授权");
      if (query.error || !query.code)
        throw new PublicError("未完成授权，可返回后重试");
      const request = eventRequest(i.url, i.caCertificate);
      try {
        await auth(provider(i), {
          serverUrl: i.url,
          authorizationCode: query.code,
          iss: query.iss,
          fetchFn: request.fetch,
        });
        return { id: i.id };
      } finally {
        await request.close();
      }
    },
    remove(id: string) {
      for (const [key, item] of pending)
        if (item.id === id) pending.delete(key);
      db.raw.prepare("DELETE FROM automation_event_oauth WHERE id=?").run(id);
    },
  };
}
