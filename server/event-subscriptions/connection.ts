import { eventFailure } from "../../packages/event-bridge/core.js";
import { eventRequest } from "./tls.js";
import {
  Client,
  StreamableHTTPClientTransport,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import {
  resolvePluginConfiguration,
  type PluginDescriptor,
} from "../plugin-descriptor.js";
import { SourceFailure } from "./contracts.js";

export type EventPeer = {
  request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any>;
  close(): Promise<void>;
  stream?(
    params: Record<string, unknown>,
    frame: (kind: string, params: Record<string, unknown>) => void,
  ): { done: Promise<void>; stop: () => void };
};
export type EventConnection = {
  descriptor: PluginDescriptor;
  values: Record<string, unknown>;
  secrets: Record<string, string>;
  caCertificate?: string;
  authProvider?: OAuthClientProvider;
};
export type OpenEventConnection = (
  connection: EventConnection,
) => Promise<EventPeer>;
export const openEventConnection: OpenEventConnection = async ({
  descriptor,
  values,
  secrets,
  caCertificate,
  authProvider,
}) => {
  if (descriptor.reason) throw new SourceFailure("conflict");
  const { definition, secrets: destinations } = resolvePluginConfiguration(
    descriptor,
    values,
  );
  for (const destination of destinations) {
    const secret = secrets[destination.id];
    if (secret === undefined) continue;
    if (destination.field.kind === "env")
      (definition.env ||= {})[destination.field.name] = secret;
    else
      (definition.http_headers ||= {})[destination.field.name] =
        destination.field.kind === "bearer" ? "Bearer " + secret : secret;
  }
  const http = eventRequest(
    definition.url || "http://localhost",
    caCertificate,
  );
  const client = new Client(
    { name: "newbot-event-bridge", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport = definition.command
    ? new StdioClientTransport({
        command: definition.command,
        args: definition.args || [],
        cwd: definition.cwd || descriptor.configRoot || descriptor.root,
        env: { PATH: process.env.PATH || "", ...definition.env },
        stderr: "ignore",
      })
    : new StreamableHTTPClientTransport(new URL(definition.url), {
        requestInit: { headers: definition.http_headers || {} },
        fetch: http.fetch,
        authProvider,
      });
  try {
    await client.connect(transport, { timeout: 10000 });
    let listener:
        | ((kind: string, params: Record<string, unknown>) => void)
        | undefined,
      streamId: string | number | undefined;
    const send = transport.send.bind(transport),
      receive = transport.onmessage;
    transport.send = async (
      message: Exclude<Parameters<typeof send>[0], unknown[]>,
    ) => {
      if (
        "method" in message &&
        message.method === "events/stream" &&
        "id" in message
      )
        streamId = message.id;
      return send(message);
    };
    transport.onmessage = (message) => {
      if (
        "method" in message &&
        message.method.startsWith("notifications/events/")
      ) {
        const params = (message.params || {}) as Record<string, unknown>;
        const meta = params._meta as Record<string, unknown> | undefined;
        if (
          listener &&
          meta?.["io.modelcontextprotocol/subscriptionId"] === streamId
        )
          listener(message.method.split("/").at(-1)!, params);
        return;
      }
      receive?.(message);
    };
    return {
      stream(params, frame) {
        if (listener) throw new SourceFailure("conflict");
        listener = frame;
        const abort = new AbortController();
        const done = client
          .request(
            { method: "events/stream", params },
            z.record(z.string(), z.unknown()),
            { signal: abort.signal, timeout: 3600000 },
          )
          .then(() => {})
          .finally(() => {
            listener = undefined;
            streamId = undefined;
          });
        return { done, stop: () => abort.abort() };
      },
      request: async (method, params, signal) =>
        client
          .request({ method, params }, z.record(z.string(), z.unknown()), {
            signal,
            timeout: 30000,
          })
          .catch((error) => {
            throw eventFailure(error);
          }),
      close: async () => {
        await client.close();
        await http.close();
      },
    };
  } catch (error) {
    await client.close().catch(() => {});
    await http.close();
    throw new SourceFailure(
      (error as { code?: number; status?: number }).code === 401 ||
      [401, 403].includes((error as { status?: number }).status || 0) ||
      /unauthorized|authorization|oauth|请重新连接/.test(
        error instanceof Error ? error.message.toLowerCase() : "",
      )
        ? "auth_required"
        : "retry",
    );
  }
};
