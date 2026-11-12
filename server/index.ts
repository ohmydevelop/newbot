import { RunnerControl } from "./runner/control.js";
import {
  runnerRoutes,
  runnerAuthentication,
  isRunnerRoute,
} from "./runner/routes.js";
import { instanceLease } from "./instance-lease.js";
import { runtimeLocations } from "./runner/locations.js";
import { captureFailure } from "./failure-store.js";
import { privateFields } from "./private-fields.js";
import { certificateInspector } from "./certificates.js";
import { randomUUID } from "node:crypto";
import { configurationOperations } from "./configuration-operations.js";
import { extensionImports } from "./imports.js";
import { IMPORT_LIMITS } from "../shared/imports.js";
import { mediaStore } from "./media.js";
import { ExtensionRuntime } from "./extension-runtime.js";
import { workspaces } from "./workspaces.js";
import { PublicError, publicErrorMessage } from "./public-error.js";
import { ProviderRuntime } from "./provider-runtime.js";
import {
  initialProviderRuntime,
  fetchProviderSource,
} from "./provider-source.js";
import { publicAppIssue } from "./app-error.js";
import { appHostPolicy } from "../shared/mcp-app-host.js";
import { publicConfigurationIssue } from "./configuration-error.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { EventEncoder } from "@ag-ui/encoder";
import { EventType, type Event } from "@ag-ui/core";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import { database, hash } from "./db.js";
import { auth } from "./auth.js";
import { oauthCallback } from "./oauth.js";
import { runStore } from "./runs.js";
import { Codex } from "./codex.js";
import { bridge } from "./bridge.js";
import {
  htmlPreviews,
  previewShell,
  previewContent,
  previewFailure,
  CONTENT_POLICY,
  PREVIEW_PERMISSIONS,
} from "./html-preview.js";
import { skillSelections } from "./skills.js";
import { pdfRoutes } from "./pdf.js";
import { artifactStore } from "./artifacts.js";
import { fileStore } from "./files.js";
import { EventFeed } from "./event-feed.js";
import { telemetry } from "./telemetry.js";
import { CODEX_VERSION } from "../generated/version.js";
import type { ServerNotification } from "../generated/codex/ServerNotification.js";
import type { ServerRequest } from "../generated/codex/ServerRequest.js";
import type { Json, Thread, SkillReference } from "../shared/types.js";
import type { ToolRequest } from "./codex.js";
import { credentialVault } from "./credential-vault.js";
import { credentialManagement } from "./credential-management.js";
import { credentialCreate, credentialClear } from "../shared/credentials.js";
import { credentialBroker, CredentialFailure } from "./credentials.js";
import { providerCredentialConsumer } from "./credential-provider.js";
import { sudoIdentity } from "./credential-sudo.js";
import { A2UI_ACTIONS } from "../shared/a2ui-chat.js";
import {
  A2UI_CATALOG_ID,
  A2UI_RICH_CATALOG_ID,
} from "../shared/a2ui-policy.js";
import { a2uiApis, richA2uiApis } from "../shared/a2ui-catalog.js";

type ServerOptions = {
  directory?: string;
  /** Opt-in while the remote resource/Bridge adapter is being verified. */
  runnerControl?: boolean;
  cwd?: string;
  password?: string;
  codex?: Codex;
  origins?: string[];
  /** Local embedding/tests may serve an isolated build without publishing live assets. */
  webDirectory?: string;
  credentialCa?: string;
  sudoIdentity?: ReturnType<typeof sudoIdentity>;
  /** null is retained for native configuration adapter contract tests. */
  providerRuntime?: ProviderRuntime | null;
};

export async function createServer(options: ServerOptions = {}) {
  const locations = runtimeLocations({
    directory: options.directory,
    cwd: options.cwd,
  });
  const lease = await instanceLease(locations.server);
  try {
    return await createServerInternal(options, locations, lease);
  } catch (error) {
    await lease.release(false);
    throw error;
  }
}

async function createServerInternal(
  options: ServerOptions,
  locations: ReturnType<typeof runtimeLocations>,
  lease: Awaited<ReturnType<typeof instanceLease>>,
) {
  const directory = locations.server;
  const cwd = locations.legacyWorkspace;
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const db = database(directory);
  const verify = auth(db, directory, options.password);
  const files = fileStore(directory, db);
  const runs = runStore(db);
  const configOperations = configurationOperations(db);
  const nodeControl =
    options.runnerControl || process.env.NEWBOT_RUNNER_CONTROL === "true"
      ? new RunnerControl(db)
      : undefined;
  const inspectCertificate = certificateInspector();
  files.cleanup();
  const vault = credentialVault(db, directory, cwd);
  const runtime =
    options.codex ||
    new Codex(cwd, () => ({
      CODEX_HOME: locations.codex,
    }));
  try {
    runtime.providerRuntime =
      options.providerRuntime === null
        ? undefined
        : await initialProviderRuntime(
            db,
            directory,
            cwd,
            options.providerRuntime,
            locations.codex,
          );
  } catch (error) {
    vault.close();
    db.raw.close();
    throw error;
  }
  if (runtime.providerRuntime) {
    const snapshot = runtime.providerRuntime.snapshot();
    const before = JSON.stringify(snapshot.values);
    vault.restoreProviderReferences(snapshot.values);
    if (JSON.stringify(snapshot.values) !== before)
      runtime.providerRuntime.apply(snapshot.revision, [
        {
          keyPath: "model_providers",
          value: snapshot.values.model_providers,
          mergeStrategy: "replace",
        },
      ]);
  }
  if (runtime.providerRuntime)
    runtime.extensionRuntime = new ExtensionRuntime(db);
  runtime.credentialSource = async () => {
    if (!vault.hasEntries) return {};
    const probe =
      options.codex && runtime.state === "ready"
        ? runtime
        : new Codex(cwd, runtime.extraEnv);
    if (probe !== runtime && runtime.providerRuntime)
      probe.providerRuntime = new ProviderRuntime();
    try {
      if (probe !== runtime) await probe.start();
      if (probe.state !== "ready") throw new PublicError("凭证配置暂不可读");
      const raw = await probe.call("config/read", { cwd, includeLayers: true });
      return vault.nativeEnv(
        runtime.providerRuntime?.effective(
          runtime.extensionRuntime?.overlay(raw).config || raw.config,
        ) || raw.config,
      );
    } finally {
      if (probe !== runtime) await probe.stopAndWait();
    }
  };
  const workspaceStore = workspaces(
    directory,
    cwd,
    db,
    locations.workspaceRoot,
  );
  const artifacts = artifactStore(directory, cwd, db, workspaceStore.root);
  const media = mediaStore(db, artifacts);
  await artifacts.maintenance(true, () => files.cleanup());
  let credentials: ReturnType<typeof credentialBroker>;
  const service = bridge(
    runtime,
    db,
    cwd,
    files,
    artifacts,
    () => credentials?.pending || 0,
    vault,
    workspaceStore,
    media,
  );
  const imports = extensionImports(directory, db, runtime, service);
  await imports.init();
  const managedCredentials = credentialManagement(service, vault);
  const privateFieldStore = privateFields(db, vault, service.configuration);
  runtime.privateFieldInfo = privateFieldStore.info;
  if (runtime.providerRuntime) {
    runtime.privateConfiguration = privateFieldStore.inject;
    runtime.privateVersion = privateFieldStore.version;
    runtime.credentialSource = async () => ({});
  }
  const sudo =
    options.sudoIdentity ||
    sudoIdentity({ enabled: process.env.SUDO_IDENTITY_CHECK === "true" });
  credentials = credentialBroker({
    validOwner: (owner) =>
      !!db.raw
        .prepare("SELECT 1 FROM sessions WHERE token=? AND expires>?")
        .get(owner, Date.now()),
    audit: (id, state) => db.audit("credentials/private-operation", id, state),
    prepare: async (input) => {
      if (input.operation === "plugin.configuration.save") {
        const detail = await service.plugins.read(input.pluginId);
        if (!detail.installed || !detail.available)
          throw new PublicError("插件不可配置");
        const consumer = await service.pluginConnections.prepare(input);
        return {
          ...consumer,
          run: async (...args: Parameters<typeof consumer.run>) => {
            const result = await consumer.run(...args);
            if (result.state === "succeeded")
              service.events.publish({
                type: EventType.CUSTOM,
                name: "newbot.configuration.changed",
                value: { scope: "extensions", pluginId: input.pluginId },
              });
            return result;
          },
        };
      }
      if (
        input.operation === "credential.fields.save" ||
        input.operation === "credential.authorize"
      ) {
        const consumer = await privateFieldStore.prepare(input);
        return {
          ...consumer,
          run: async (...args: Parameters<typeof consumer.run>) => {
            const result = await consumer.run(...args);
            if (
              result.state === "succeeded" &&
              input.operation === "credential.fields.save"
            )
              service.events.publish({
                type: EventType.CUSTOM,
                name: "newbot.configuration.changed",
                value: { scope: input.scope, targetId: input.targetId },
              });
            return result;
          },
        };
      }
      if (input.operation === "sudo.identity")
        return sudo.prepare(
          input.expectedPolicy,
          () => service.inspectPrivateConfiguration(async () => {}),
          (run) => service.privateConfiguration(true, run),
        );
      if (input.operation === "credential.save")
        return managedCredentials.prepare(input);
      if (input.operation === "provider.save")
        return managedCredentials.prepareGateway(input);
      const operation = await service.preparePrivateProbe(
        input.expectedRevision,
        input.providerId,
      );
      return providerCredentialConsumer(
        operation.receiver,
        operation.checked,
        options.credentialCa,
      );
    },
  });
  const previews = htmlPreviews(db, artifacts);
  const artifactsChanged = (threadId: string) => {
    const thread = service.events.threads.get(threadId);
    if (thread) {
      artifacts.decorate(media.decorate(thread));
      service.events.publish(service.events.snapshot(threadId));
    }
  };
  const traces = await telemetry();
  const production = process.env.NODE_ENV === "production";
  const origins = new Set(
    options.origins ||
      (process.env.PUBLIC_ORIGIN
        ? process.env.PUBLIC_ORIGIN.split(",").map((s) => s.trim())
        : production
          ? ["http://localhost:3100"]
          : [
              "http://localhost:5173",
              "http://127.0.0.1:5173",
              "http://localhost:3100",
              "http://127.0.0.1:3100",
            ]),
  );
  for (const origin of origins)
    if (new URL(origin).origin !== origin)
      throw new PublicError("PUBLIC_ORIGIN 必须是精确的 origin，不包含路径");
  const secure = [...origins].every((o) => o.startsWith("https://"));
  const app = Fastify({
    logger: false,
    bodyLimit: 9 * 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "true" ? "loopback" : false,
  });
  await app.register(cookie);
  if (nodeControl) runnerRoutes(app, nodeControl);
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  const sandboxOrigins = new Set(
    [...origins]
      .filter((o) => ["localhost", "127.0.0.1"].includes(new URL(o).hostname))
      .flatMap((o) => {
        const u = new URL(o);
        const alternate = new URL(o);
        alternate.hostname =
          u.hostname === "localhost" ? "127.0.0.1" : "localhost";
        return [alternate.origin];
      }),
  );
  if (process.env.APP_ORIGIN) {
    const u = new URL(process.env.APP_ORIGIN);
    if (u.origin !== process.env.APP_ORIGIN || origins.has(u.origin))
      throw new PublicError("APP_ORIGIN 必须是与主站不同的独立 origin");
    sandboxOrigins.add(u.origin);
  }
  // An authority used by the main app can never serve active sandbox documents.
  const mainHosts = new Set([...origins].map((o) => new URL(o).host));
  for (const origin of sandboxOrigins)
    if (mainHosts.has(new URL(origin).host)) sandboxOrigins.delete(origin);
  const isolatedOrigin = (main: string) =>
    process.env.APP_ORIGIN && sandboxOrigins.has(process.env.APP_ORIGIN)
      ? process.env.APP_ORIGIN
      : [...sandboxOrigins].find((o) => new URL(o).port === new URL(main).port);
  const documents = new Map<string, { html: string; expires: number }>();
  service.apps.onRevoke((token) => documents.delete(token));
  const streams = new Map<
    ServerResponse,
    { session: string; threadId?: string }
  >();
  const initialEvents = (): Event[] => [
    service.activity.snapshot(),
    {
      type: EventType.CUSTOM,
      name: "newbot.runtime",
      value: { state: runtime.state, reason: runtime.reason },
    },
    {
      type: EventType.CUSTOM,
      name: "newbot.approval.snapshot",
      value: service.elicitation.list(),
    },
    ...[...service.events.threads.keys()].map((id) =>
      service.events.snapshot(id),
    ),
  ];
  const feed = new EventFeed(initialEvents);
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  const write = (res: ServerResponse, event: Event) => {
    if (res.destroyed || res.writableEnded) return;
    if (res.writableLength > 2 * 1024 * 1024) {
      res.end();
      return;
    }
    res.write(encoder.encode(event));
  };
  service.events.on("event", (event: Event) => {
    feed.push(event);
    for (const [res, { session, threadId }] of streams) {
      if (!db.validSession(session)) {
        res.end();
        continue;
      }
      const id =
        event.metadata?.threadId ||
        ("threadId" in event ? event.threadId : undefined);
      if (threadId && id && threadId !== id) continue;
      write(res, event);
    }
  });
  runtime.on("status", () => {
    operational("runtime.status", runtime.state);
    if (runtime.state === "offline") {
      service.activity.offline();
      service.ui.stopped();
      credentials.revoke();
      for (const thread of service.events.threads.values())
        for (const turn of thread.turns)
          if (turn.status === "inProgress") {
            turn.status = "interrupted";
            turn.error = {
              message: "Codex 进程已中断；请检查任务状态后重新执行",
            };
            thread.status = { type: "notLoaded" };
            traces.turnEnd(turn.id, "process_stopped");
          }
      for (const id of service.events.threads.keys())
        service.events.publish(service.events.snapshot(id));
      service.apps.clear();
      service.events.resetTransient();
    }
    service.events.runtime(runtime.state, runtime.reason);
  });
  runtime.on("approval", (request: ServerRequest) => {
    if (db.owns((request.params as Json).threadId)) {
      service.activity.approval(
        request.id,
        request.params as Json,
        request.method,
      );
      service.events.approval(service.elicitation.publicApproval(request));
    }
  });
  runtime.on("resolved", (id: string | number) => {
    service.activity.resolved(id);
    service.events.resolved(id);
  });
  runtime.on("tool", (request: ToolRequest) => service.ui.handle(request));
  runtime.on("toolResolved", (id: string | number) => service.ui.resolved(id));
  runtime.on("event", (message: ServerNotification) => {
    const p = message.params as Json;
    if (message.method === "serverRequest/resolved") {
      service.activity.resolved(p.requestId);
      service.events.resolved(p.requestId);
      return;
    }
    if (!db.owns(p.threadId || p.thread?.id)) return;
    if (message.method === "item/completed") {
      media.completed(p.threadId, p.turnId, p.item, () =>
        artifactsChanged(p.threadId),
      );
      service.apps.register(p.threadId, p.item);
      if (p.item.type === "userMessage" && p.item.clientId) {
        const row = db.raw
          .prepare(
            "SELECT request_id FROM runs WHERE client_message_id=? AND thread_id=?",
          )
          .get(p.item.clientId, p.threadId) as
          | { request_id: string }
          | undefined;
        if (row) runs.update(row.request_id, "accepted", p.threadId, p.turnId);
      }
    }
    if (message.method === "turn/started")
      traces.turnStart(p.threadId, p.turn.id);
    if (message.method === "turn/completed") {
      service.ui.stopped(p.threadId);
      const run = db.raw
        .prepare("SELECT request_id FROM runs WHERE thread_id=? AND turn_id=?")
        .get(p.threadId, p.turn.id) as { request_id: string } | undefined;
      if (run) {
        const ephemeralThread = privateFieldStore.finish(run.request_id);
        if (ephemeralThread)
          void runtime.unload(ephemeralThread).catch(() => {});
      }
      db.touch(p.threadId);
      traces.turnEnd(p.turn.id, p.turn.status);
    }
    captureFailure(db, message.method, p);
    service.activity.notification(message);
    service.events.notification(message);
    const uiThread = service.events.threads.get(p.threadId);
    if (uiThread && service.ui.anchors(uiThread))
      service.events.publish(service.events.snapshot(p.threadId));
    if (message.method === "item/completed" && p.item.type === "mcpToolCall") {
      const thread = service.events.threads.get(p.threadId);
      if (thread) {
        service.apps.decorate(thread);
        service.events.publish(service.events.snapshot(p.threadId));
      }
    }
    if (message.method === "item/completed" && p.item.type === "userMessage") {
      const thread = service.events.threads.get(p.threadId);
      if (thread) {
        service.skillUses.decorate(thread);
        service.pluginUses.decorate(thread);
        service.events.publish(service.events.snapshot(p.threadId));
      }
    }
    if (message.method === "item/completed")
      artifacts.completed(p.threadId, p.turnId, p.item, () =>
        artifactsChanged(p.threadId),
      );
  });
  app.addHook("onRequest", async (req, reply) => {
    const sandboxPath =
      /^\/(?:sandbox|artifact-preview|artifact-content)\//.test(req.url);
    const sandboxHost = [...sandboxOrigins].some(
      (o) => new URL(o).host === req.headers.host,
    );
    if (sandboxPath || sandboxHost) {
      reply
        .header(
          "Content-Security-Policy",
          `${CONTENT_POLICY}; frame-ancestors ${[...origins].join(" ")} ${[...sandboxOrigins].join(" ")}`,
        )
        .header("Permissions-Policy", PREVIEW_PERMISSIONS)
        .header("Referrer-Policy", "no-referrer")
        .header("X-Content-Type-Options", "nosniff")
        .header("X-DNS-Prefetch-Control", "off")
        .header("Connection-Allowlist", "()")
        .header("Cache-Control", "no-store");
      if (!sandboxHost || !sandboxPath)
        return reply.code(403).send("Invalid sandbox host or path");
      return;
    }
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'${production ? "" : " ws://localhost:5173 ws://127.0.0.1:5173"}; frame-src 'self' blob: ${[...sandboxOrigins].join(" ")}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    );
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (nodeControl && isRunnerRoute(req.url))
      return runnerAuthentication(req, reply, nodeControl);
    if (req.headers.origin && !origins.has(req.headers.origin))
      return reply.code(403).send({ error: "来源验证失败" });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !origins.has(req.headers.origin || "")
    )
      return reply.code(403).send({ error: "来源验证失败" });
    if (
      req.url.startsWith("/api/") &&
      !["/api/login", "/api/session", "/api/health", "/api/ready"].includes(
        req.url.split("?")[0],
      ) &&
      !db.validSession(req.cookies.ma_session)
    )
      return reply.code(401).send({ error: "请先登录" });
  });
  app.addHook("onResponse", async (req, reply) => {
    // Never log URLs, query strings, headers, request bodies, errors or tool payloads.
    // Polling heartbeats are aggregate health traffic; log failures, not every successful poll.
    if (
      req.routeOptions.url === "/api/mcp-apps/:action" &&
      (req.params as { action?: string })?.action === "status" &&
      reply.statusCode < 400
    )
      return;
    if (
      req.routeOptions.url === "/api/agent/events" &&
      reply.statusCode === 200
    )
      return;
    operational("http.request", reply.statusCode >= 400 ? "error" : "ok", {
      requestId: req.id,
      route: req.routeOptions.url || "unmatched",
      method: [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ].includes(req.method)
        ? req.method
        : "OTHER",
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });
  app.setErrorHandler((error, req, reply) => {
    const reportedStatus = (error as { statusCode?: unknown }).statusCode;
    const revisionError =
      error instanceof z.ZodError &&
      error.issues.some((issue) => issue.path[0] === "expectedRevision");
    const issue = revisionError
      ? { code: "conflict", persistence: "unchanged", recovery: "read" }
      : publicConfigurationIssue(error);
    reply
      .code(
        error instanceof z.ZodError
          ? 400
          : typeof reportedStatus === "number" &&
              Number.isInteger(reportedStatus) &&
              reportedStatus >= 400 &&
              reportedStatus <= 599
            ? reportedStatus
            : 400,
      )
      .send({
        error: revisionError
          ? "请刷新页面并重新读取配置，再确认并保存修改"
          : error instanceof z.ZodError
            ? "请求参数无效"
            : safeError(error),
        ...(issue ? { configurationIssue: issue } : {}),
        ...(publicAppIssue(error) ? { appIssue: publicAppIssue(error) } : {}),
      });
  });
  oauthCallback(app, origins);
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/ready", async (_req, reply) => {
    const ready = runtime.state === "ready" && !service.busy;
    reply.code(ready ? 200 : 503);
    return { ready, runtime: runtime.state };
  });
  app.get("/api/runtime/metrics", async () => ({
    uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    activeTurns: runtime.active.size,
    pendingApprovals: runtime.approvals.size,
    pendingForms: service.ui.pending,
    pendingPrivateInputs: credentials.pending,
    cachedThreads: service.events.threads.size,
    appRecords: service.apps.records.size,
  }));
  app.get("/api/session", async (req) => ({
    authenticated: db.validSession(req.cookies.ma_session),
  }));
  app.post("/api/login", { bodyLimit: 2048 }, async (req, reply) => {
    const { password } = z
      .object({ password: z.string().max(1024) })
      .parse(req.body);
    try {
      if (!(await verify(req.ip, password)))
        return reply.code(401).send({ error: "密码不正确" });
    } catch (e) {
      return reply.code(429).send({ error: publicErrorMessage(e) });
    }
    reply.setCookie("ma_session", db.createSession(), {
      httpOnly: true,
      secure: secure || req.headers.origin?.startsWith("https://") === true,
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 86400,
    });
    return { ok: true };
  });
  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies.ma_session!;
    service.apps.revokeSession(hash(token));
    credentials.revoke(hash(token));
    db.logout(token);
    previews.revokeSession(token);
    for (const [res, value] of streams) if (value.session === token) res.end();
    reply.clearCookie("ma_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/runtime/capabilities", async () => ({
    agent: "codex",
    version: CODEX_VERSION,
    status: runtime.state,
    transport: "stdio",
    webTransport: process.env.AGENT_TRANSPORT === "poll" ? "poll" : "sse",
    eventProtocol: { name: "AG-UI", sdk: "1.0.4" },
    capabilities: {
      threads: true,
      streaming: true,
      approvals: true,
      elicitation: {
        forms: true,
        fields: 12,
        options: 32,
        timeoutSeconds: 300,
        sensitiveInput: false,
        urlMode: false,
      },
      presentation: {
        catalogs: [A2UI_CATALOG_ID, A2UI_RICH_CATALOG_ID],
        newThreads: A2UI_RICH_CATALOG_ID,
        threadCapability: "uiCatalog",
      },
      media: {
        authenticatedSnapshots: true,
        publicHttps: true,
        maxBytes: 8 * 1024 * 1024,
        formats: ["png", "jpeg", "webp"],
      },
      imports: {
        available: !!runtime.extensionRuntime,
        sources: ["directory", "zip", "public-github"],
        limits: IMPORT_LIMITS,
        nativePluginFormats: ["portable", "codex"],
      },
      models: true,
      plugins: {
        experimental: true,
        available: service.plugins.enabled(),
        configuredMarketplacesOnly: true,
        componentManagement: true,
        upgrades: {
          importedPackages: true,
          marketplaceVersionRequired: true,
          automatic: false,
        },
        configuration: {
          descriptor: "mcpb-manifest",
          manifestVersions: ["0.3"],
          certificateInspection: true,
          fields: ["string", "number", "boolean"],
          privateInput: !!runtime.privateConfiguration,
        },
      },
      sessionSettings: {
        available: runtime.state === "ready",
        sameThreadProviderSwitch:
          runtime.runtimeCapabilities?.sameThreadProviderSwitch === true,
        liveSettings: runtime.runtimeCapabilities?.liveModelRoutes === true,
        verifiedModelRoutes:
          runtime.runtimeCapabilities?.verifiedModelRoutes === true,
        pinnedPluginResources:
          runtime.runtimeCapabilities?.pinnedPluginRoots === true,
        revisioned: true,
        nextTurnSettings: true,
        persistentInputReferences: true,
      },
      providerManagement: {
        storage: runtime.providerRuntime?.storage || "native",
        hotUpdate: !!runtime.providerRuntime,
        resupplyAfterRestart: runtime.providerRuntime?.storage === "memory",
        restoreAfterRestart: runtime.providerRuntime?.storage === "sqlite",
        configuration: true,
        privateEditor: true,
        generatedIds: true,
        nativeDiscovery: true,
        responsesDiagnostic: true,
      },
      configuration: {
        versionedDefaults: true,
        redactedInventory: true,
        recovery: true,
      },
      mcp: true,
      mcpManagement: {
        configuration: true,
        nativeDiscovery: true,
        versionedReload: true,
      },
      skills: true,
      skillSelection: {
        structuredInput: true,
        history: true,
        maxPerMessage: 8,
      },
      experts: { available: true, perSession: 1 },
      skillDocuments: { read: true, maxBytes: 262144 },
      skillManagement: { uninstall: "personalArchive", sourceChecked: true },
      mcpApps: sandboxOrigins.size > 0,
      mcpAppHost: {
        ...appHostPolicy(sandboxOrigins.size > 0),
        available: sandboxOrigins.size > 0,
      },
      mcpAppLifecycle: {
        leases: true,
        close: true,
        status: true,
        cancel: true,
        sessionBound: true,
      },
      files: true,
      artifacts: {
        registration: true,
        versions: true,
        storageManagement: true,
        controlledRead: true,
        preview: true,
        previewKinds: [
          "text",
          "code",
          "markdown",
          "json",
          "csv",
          "image",
          "pdf",
          ...(sandboxOrigins.size ? ["html"] : []),
        ],
        htmlExecution: sandboxOrigins.size > 0,
        htmlPreview: {
          isolation: "opaque-sandbox",
          lifetimeSeconds: 300,
          resources: "inline-only",
          network: "csp-and-connection-allowlist",
        },
        pdfPreview: true,
        pdf: { range: true, maxPages: 500, maxCanvasPixels: 8000000 },
      },
      traces: traces.enabled,
      privateCredentials: true,
      runRecovery: { abandonUnseen: true },
      trustedInput: {
        errorOutputVersion: 1,
        operations: [
          "provider.models.test",
          "credential.save",
          ...(runtime.privateConfiguration
            ? [
                "plugin.configuration.save",
                "credential.fields.save",
                "credential.authorize",
              ]
            : []),
          ...(sudo.capability().available ? ["sudo.identity"] : []),
        ],
        apiKeyProbe: true,
        persistence: true,
        storage: {
          memory: true,
          encrypted: vault.encryptionAvailable,
          providerBearer: true,
          mcpHttpBearer: true,
          stdio: !!runtime.privateConfiguration,
          httpHeaders: !!runtime.privateConfiguration,
        },
        agentRequests: !!runtime.privateConfiguration,
        fields: !!runtime.privateConfiguration,
        sudo: sudo.capability().available,
        sudoIdentity: sudo.capability(),
      },
      a2ui: {
        available: true,
        protocol: "v0.9",
        catalog: A2UI_RICH_CATALOG_ID,
        components: Object.keys(richA2uiApis).length,
        catalogs: [
          { id: A2UI_CATALOG_ID, components: Object.keys(a2uiApis) },
          { id: A2UI_RICH_CATALOG_ID, components: Object.keys(richA2uiApis) },
        ],
        actions: A2UI_ACTIONS,
        nativeDynamicTools: true,
        newThreadsOnly: true,
        historyRestoration: true,
        drafts: { serverSide: true, retentionHours: 24, restartReadOnly: true },
        privateInput: false,
      },
      a2a: false,
      acp: false,
    },
    mcp: { negotiation: "codex-managed", protocolVersion: null },
    mcpApps: { network: false, inlineDependenciesOnly: true },
  }));
  const privateOrigin = (origin: string | undefined) => {
    if (!origin) throw new CredentialFailure("私密输入来源无效", 403);
    const url = new URL(origin);
    if (
      url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new CredentialFailure("私密输入需要安全连接", 403);
  };
  app.post("/api/plugins/certificate", { bodyLimit: 8192 }, async (req) =>
    service.pluginConnections.certificate(req.body, inspectCertificate),
  );
  app.post("/api/credentials/requests", { bodyLimit: 8192 }, async (req) => {
    privateOrigin(req.headers.origin);
    const input = credentialCreate.parse(req.body),
      owner = hash(req.cookies.ma_session!);
    if (
      [
        "plugin.configuration.save",
        "credential.fields.save",
        "credential.authorize",
      ].includes(input.operation) &&
      !runtime.privateConfiguration
    )
      throw new PublicError(
        "此运行模式暂不支持私密字段，请启用 SQLite 运行配置。",
      );
    if (
      input.operation === "credential.fields.save" ||
      input.operation === "plugin.configuration.save"
    ) {
      const fingerprint = hash(JSON.stringify(input));
      const prior = db.raw
        .prepare(
          "SELECT owner,fingerprint,result FROM private_operations WHERE id=?",
        )
        .get(input.requestId) as
        | { owner: string; fingerprint: string; result: string | null }
        | undefined;
      if (prior) {
        if (prior.owner !== owner || prior.fingerprint !== fingerprint)
          throw new PublicError("请勿复用私密请求标识");
        if (prior.result) return JSON.parse(prior.result);
        try {
          return credentials.read(input.requestId, owner);
        } catch {
          throw new PublicError("保存结果未确认，请刷新凭证设置后重新操作。");
        }
      } else
        db.raw
          .prepare("INSERT INTO private_operations VALUES(?,?,?,NULL,?)")
          .run(input.requestId, owner, fingerprint, Date.now());
    }
    return credentials.create(owner, input);
  });
  app.get("/api/runtime/config", async () => ({
    storage: runtime.providerRuntime?.storage || "native",
    configuration: await service.providerConfiguration(),
    requiresResupplyAfterRestart: runtime.providerRuntime?.storage === "memory",
  }));
  app.post("/api/runtime/config", { bodyLimit: 131072 }, async (req) => {
    const data = z
      .strictObject({
        expectedRevision: z.string().regex(/^cfg1\.[a-f0-9]{64}$/),
        providers: z.unknown(),
        defaults: z.unknown().optional(),
      })
      .parse(req.body);
    return {
      configuration: await service.publishProviderConfiguration(
        {
          providers: data.providers,
          ...(data.defaults ? { defaults: data.defaults } : {}),
        },
        data.expectedRevision,
      ),
    };
  });
  app.post("/api/runtime/config/reload", { bodyLimit: 2048 }, async (req) => {
    const data = z
      .strictObject({
        expectedRevision: z.string().regex(/^cfg1\.[a-f0-9]{64}$/),
      })
      .parse(req.body);
    const source = await fetchProviderSource();
    return {
      configuration: await service.publishProviderConfiguration(
        source,
        data.expectedRevision,
      ),
    };
  });
  app.post("/api/credentials/apply", { bodyLimit: 2048 }, async (req) => {
    privateOrigin(req.headers.origin);
    const data = z
      .strictObject({
        expectedRevision: z.string().regex(/^cfg1\.[a-f0-9]{64}$/),
      })
      .parse(req.body);
    return service.privateConfiguration(false, async (core) => {
      if ((await core.read()).publicView.revision !== data.expectedRevision)
        throw new PublicError("配置已变化，请重新读取");
      await service.reloadPrivateRuntime();
      return { state: "ready" };
    });
  });
  app.post("/api/credentials/clear", { bodyLimit: 2048 }, async (req) => {
    privateOrigin(req.headers.origin);
    return managedCredentials.clear(credentialClear.parse(req.body));
  });
  app.get("/api/credentials/:id", async (req) => {
    const id = z
        .string()
        .uuid()
        .parse((req.params as Json).id),
      owner = hash(req.cookies.ma_session!);
    const saved = db.raw
      .prepare("SELECT result FROM private_operations WHERE id=? AND owner=?")
      .get(id, owner) as { result: string | null } | undefined;
    if (saved?.result) return JSON.parse(saved.result);
    return credentials.read(id, owner);
  });
  app.delete("/api/credentials/:id", async (req) =>
    credentials.cancel(
      z
        .string()
        .uuid()
        .parse((req.params as { id: string }).id),
      hash(req.cookies.ma_session!),
    ),
  );
  app.post(
    "/api/credentials/:id/input",
    { bodyLimit: 1048576 },
    async (req) => {
      const body = req.body;
      try {
        privateOrigin(req.headers.origin);
        if (
          !Buffer.isBuffer(body) ||
          req.headers["content-type"] !== "application/octet-stream"
        )
          throw new CredentialFailure("私密输入格式无效", 400);
        return await traces.operation("bridge.credentials.consume", () =>
          credentials.fulfill(
            z
              .string()
              .uuid()
              .parse((req.params as { id: string }).id),
            hash(req.cookies.ma_session!),
            body,
          ),
        );
      } finally {
        if (Buffer.isBuffer(body)) body.fill(0);
        req.body = undefined;
      }
    },
  );
  app.get("/api/skills/:id", async (req) =>
    service.handle("skills/read", { id: (req.params as { id: string }).id }),
  );
  app.get("/api/a2ui/:id", async (req) =>
    service.ui.read(
      z
        .string()
        .uuid()
        .parse((req.params as { id: string }).id),
    ),
  );
  app.post("/api/a2ui/action", { bodyLimit: 80 * 1024 }, async (req) =>
    service.ui.submit(req.body),
  );
  app.post("/api/a2ui/draft", { bodyLimit: 80 * 1024 }, async (req) =>
    service.ui.draft(req.body),
  );
  app.delete("/api/a2ui/draft", { bodyLimit: 80 * 1024 }, async (req) =>
    service.ui.draft(req.body, true),
  );
  app.get("/api/imports", async () => imports.list());
  app.post("/api/imports", { bodyLimit: 8192 }, async (req) =>
    imports.create(req.body),
  );
  app.get("/api/imports/:id", async (req) =>
    imports.get((req.params as { id: string }).id),
  );
  app.put(
    "/api/imports/:id/file",
    { bodyLimit: IMPORT_LIMITS.fileBytes },
    async (req) =>
      imports.upload(
        (req.params as { id: string }).id,
        z.string().parse((req.query as any).path),
        req.body as Buffer,
      ),
  );
  app.put(
    "/api/imports/:id/archive",
    { bodyLimit: IMPORT_LIMITS.archiveBytes },
    async (req) =>
      imports.upload(
        (req.params as { id: string }).id,
        "",
        req.body as Buffer,
        true,
      ),
  );
  app.post("/api/imports/:id/scan", { bodyLimit: 1024 }, async (req) =>
    imports.scan((req.params as { id: string }).id),
  );
  app.post("/api/imports/:id/install", { bodyLimit: 512 * 1024 }, async (req) =>
    imports.install((req.params as { id: string }).id, req.body),
  );
  app.delete("/api/imports/:id", async (req) => {
    await imports.discard((req.params as { id: string }).id);
    return { ok: true };
  });
  app.get("/api/config", async (req) => {
    const query = z
      .object({ view: z.literal("saved").optional() })
      .parse(req.query);
    return traces.operation("bridge.config.read", () =>
      service.settings(query.view !== "saved"),
    );
  });
  app.get("/api/config/discovery", async (req) => {
    const { section } = z
      .object({ section: z.enum(["models", "skills", "mcp"]) })
      .parse(req.query);
    return service.discoverSettings(section);
  });
  app.post("/api/config", async (req) => {
    const p = z
      .object({
        action: z.enum([
          "settings/defaults",
          "skills/config/write",
          "provider/save",
          "gateway/save",
          "provider/delete",
          "mcp/save",
          "mcp/delete",
          "mcp/enabled",
        ]),
      })
      .passthrough()
      .parse(req.body);
    return configOperations.run(
      req.headers["x-newbot-operation-id"],
      hash(req.cookies.ma_session!),
      p,
      () => service.handle(p.action, p),
    );
  });
  app.get("/api/config/operations/:id", async (req) =>
    configOperations.read(
      (req.params as { id: string }).id,
      hash(req.cookies.ma_session!),
    ),
  );
  app.get("/api/threads", async () => service.handle("thread/list", {}));
  app.get("/api/threads/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { cursor } = z
      .object({ cursor: z.string().max(1000).optional() })
      .parse(req.query);
    return service.read(id, cursor);
  });
  const runningRequests = new Map<string, Promise<Json>>();
  const waitingRuns = new Map<
    string,
    { start: () => Promise<Json>; cancel: () => void; expires: number }
  >();
  const authorizationRequests = new Map<
    string,
    { threadId: string; state: string; expires: number }
  >();
  async function authorizationContext(threadId: string) {
    if (!db.owns(threadId)) throw new PublicError("会话不存在");
    if (!runtime.privateConfiguration)
      throw new PublicError("当前运行模式不支持会话私密授权");
    return {
      runId: "",
      threadId,
      provider: service.runtimeSettings.get(threadId).provider,
      config: (await service.configuration.read()).response.config,
    };
  }
  app.get("/api/credentials/threads/:id", async (req) => {
    const context = await authorizationContext(
      z.string().parse((req.params as Json).id),
    );
    return {
      targets: privateFieldStore.targets(context),
      authorized: privateFieldStore.hasThreadGrant(context.threadId),
    };
  });
  app.post("/api/credentials/threads/:id/requests", async (req) => {
    const context = await authorizationContext(
      z.string().parse((req.params as Json).id),
    );
    const target = z
      .strictObject({
        scope: z.enum(["provider", "mcp"]),
        targetId: z.string(),
      })
      .parse(req.body);
    if (
      !privateFieldStore
        .targets(context)
        .some((t) => t.scope === target.scope && t.targetId === target.targetId)
    )
      throw new PublicError("此接收方没有可授权的字段");
    if (authorizationRequests.size >= 32)
      throw new PublicError("请先关闭已有授权请求");
    const id = randomUUID();
    privateFieldStore.bind({
      ...context,
      runId: id,
      force: `${target.scope}:${target.targetId}`,
      only: `${target.scope}:${target.targetId}`,
    });
    authorizationRequests.set(id, {
      threadId: context.threadId,
      state: "waiting",
      expires: Date.now() + 120000,
    });
    return { requestId: id, privateInputs: privateFieldStore.pending(id) };
  });
  app.get("/api/credentials/authorizations/:id", async (req) => {
    const id = z
        .string()
        .uuid()
        .parse((req.params as Json).id),
      entry = authorizationRequests.get(id);
    if (!entry) throw new PublicError("授权请求已结束");
    return { state: entry.state, privateInputs: privateFieldStore.pending(id) };
  });
  app.delete("/api/credentials/authorizations/:id", async (req) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as Json).id);
    authorizationRequests.delete(id);
    privateFieldStore.finish(id);
    return { state: "closed" };
  });
  db.raw
    .prepare(
      "UPDATE runs SET state='rejected' WHERE state='awaiting_credentials'",
    )
    .run();
  privateFieldStore.onReady = (requestId) => {
    const authorization = authorizationRequests.get(requestId);
    if (authorization) {
      authorization.state = "authorized";
      privateFieldStore.finish(requestId);
      return;
    }
    const held = waitingRuns.get(requestId);
    if (!held || privateFieldStore.pending(requestId).length) return;
    waitingRuns.delete(requestId);
    const operation = held.start();
    runningRequests.set(requestId, operation);
    void operation
      .catch((error) => {
        db.set(`run-failure:${requestId}`, publicErrorMessage(error));
      })
      .finally(() => runningRequests.delete(requestId));
  };
  app.post("/api/credentials/runs/:id/cancel", async (req) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as Json).id);
    const held = waitingRuns.get(id);
    if (held) {
      waitingRuns.delete(id);
      held.cancel();
    }
    return { state: runs.get(id)?.state || "unseen" };
  });
  app.delete("/api/credentials/threads/:id", async (req) => {
    const id = z.string().parse((req.params as Json).id);
    if (!db.owns(id)) throw new PublicError("会话不存在");
    privateFieldStore.revoke(id);
    for (const [runId, held] of waitingRuns)
      if (runs.get(runId)?.thread_id === id) {
        waitingRuns.delete(runId);
        held.cancel();
      }
    for (const [requestId, entry] of authorizationRequests)
      if (entry.threadId === id) {
        authorizationRequests.delete(requestId);
        privateFieldStore.finish(requestId);
      }
    const active = service.events.threads
      .get(id)
      ?.turns.find((t) => t.status === "inProgress");
    if (active)
      await service.handle("turn/interrupt", {
        threadId: id,
        turnId: active.id,
      });
    else await runtime.unload(id);
    return { state: "revoked" };
  });
  app.post(
    "/api/agent/runs/:requestId/abandon",
    { bodyLimit: 1024 },
    async (req, reply) => {
      z.strictObject({}).parse(req.body);
      const id = z
        .string()
        .uuid()
        .parse((req.params as Json).requestId);
      if (db.get(`run:${id}`))
        return reply.code(409).send({
          requestId: id,
          state: "unknown",
          error: "已有历史发送记录，不能直接放弃，请核对任务状态",
        });
      const run = runs.abandon(id);
      if (!["abandoned", "rejected"].includes(run.state))
        return reply.code(409).send({
          ...runs.view(run),
          error: "已有提交记录，不能直接放弃，请核对任务状态",
        });
      db.audit("agent/abandon", id, run.state);
      return runs.view(run);
    },
  );
  app.get("/api/agent/runs/:requestId", async (req, reply) => {
    const requestId = z
      .string()
      .uuid()
      .parse((req.params as Json).requestId);
    const run = runs.get(requestId);
    if (!run) {
      const legacy = db.get(`run:${requestId}`);
      if (legacy) {
        try {
          const value = JSON.parse(legacy);
          return {
            requestId,
            state: value.turn?.id ? "accepted" : "unknown",
            threadId: value.threadId,
            turn: value.turn?.id ? { id: value.turn.id } : undefined,
          };
        } catch {
          return { requestId, state: "unknown" };
        }
      }
      return reply.code(404).send({ error: "请求不存在" });
    }
    // A positive client message match proves submission. An absent match never proves non-submission.
    if (
      run.thread_id &&
      !run.turn_id &&
      ["dispatching", "unknown"].includes(run.state) &&
      runtime.state === "ready"
    ) {
      let cursor: string | undefined;
      try {
        for (let page = 0; page < 10; page++) {
          const history = await runtime.call("thread/turns/list", {
            threadId: run.thread_id,
            limit: 30,
            sortDirection: "desc",
            itemsView: "full",
            ...(cursor ? { cursor } : {}),
          });
          const turn = history.data.find((t) =>
            t.items.some(
              (i) =>
                i.type === "userMessage" &&
                (i.clientId === run.client_message_id ||
                  i.id === run.client_message_id),
            ),
          );
          if (turn) {
            runs.update(requestId, "accepted", run.thread_id, turn.id);
            break;
          }
          if (!history.nextCursor) break;
          cursor = history.nextCursor;
        }
      } catch {
        /* Leave unknown rather than guessing or retrying. */
      }
    }
    const current = runs.get(requestId)!;
    const value: Json = {
      ...runs.view(current),
      privateInputs: privateFieldStore.pending(requestId),
      ...(db.get(`run-failure:${requestId}`)
        ? { error: db.get(`run-failure:${requestId}`) }
        : {}),
    };
    const turn =
      current.thread_id &&
      service.events.threads
        .get(current.thread_id)
        ?.turns.find((t) => t.id === current.turn_id);
    if (turn) value.turn = { id: turn.id, status: turn.status };
    return value;
  });
  app.post("/api/agent/run", { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const p = z
      .object({
        threadId: z.string().max(200).optional(),
        text: z.string().trim().min(1).max(200000),
        provider: z.string().max(200).optional(),
        model: z.string().max(200).optional(),
        effort: z.string().max(40).optional(),
        runtimeRevision: z.number().int().nonnegative().optional(),
        expertId: z.string().uuid().nullable().optional(),
        extensionRevision: z.number().int().nonnegative().optional(),
        inputRevision: z.number().int().nonnegative().optional(),
        approval: z.enum(["ask", "review", "full"]).optional(),
        attachments: z.array(z.string().uuid()).max(8).default([]),
        skills: skillSelections.optional(),
        plugins: z.array(z.string().min(1).max(200)).max(8).optional(),
        requestId: z.string().uuid(),
      })
      .parse(req.body);
    if (!p.skills?.length) delete p.skills;
    // Preserve successful idempotency records created by v0.2.
    const legacy = db.get(`run:${p.requestId}`);
    if (legacy) {
      if (
        db.get(`run:${p.requestId}:fingerprint`) !==
        hash(JSON.stringify({ ...p, requestId: undefined }))
      )
        throw new PublicError("同一 requestId 不能用于不同的请求");
      return JSON.parse(legacy);
    }
    const prior = runs.get(p.requestId);
    if (prior?.state === "abandoned")
      return reply.code(409).send({
        ...runs.view(prior),
        error: "该发送已放弃，迟到的请求不会执行",
      });
    if (!prior) {
      if (runtime.state !== "ready" || service.busy)
        return reply.code(503).send({ error: "Codex 尚未就绪，请稍后重试" });
      const limit = Math.max(
        1,
        Math.min(5, Number(process.env.MAX_ACTIVE_TURNS) || 2),
      );
      if (
        runningRequests.size + runtime.active.size >= limit ||
        waitingRuns.size >= 10
      )
        return reply.code(429).send({ error: "并行任务已满，请等待任务结束" });
      if (
        p.threadId &&
        db.raw
          .prepare(
            "SELECT 1 FROM runs WHERE thread_id=? AND state='awaiting_credentials'",
          )
          .get(p.threadId)
      )
        return reply
          .code(409)
          .send({ error: "此会话有等待授权的任务，请先授权或取消。" });
      if (p.threadId && !db.owns(p.threadId))
        throw new PublicError("会话不存在");
      files.inputs(p.attachments); // Validate before creating a durable reservation.
      await service.skills.prepare(p.skills || []);
      if (p.plugins?.length) await service.plugins.inputs(p.plugins);
    }
    const providerConfigRevision = prior
      ? undefined
      : runtime.providerRuntime?.revision;
    const releaseProviderConfig = !prior
      ? runtime.providerRuntime?.retain(providerConfigRevision)
      : undefined;
    let ownsReservation = false;
    try {
      const expertSelection = prior ? null : await service.experts.capture(p);
      const bound = prior
        ? null
        : {
            ...service.inputs.capture(p),
            ...(await service.runtimeSettings.capture(
              p,
              providerConfigRevision,
            )),
            ...expertSelection!,
            extensionSnapshot: await service.extensions?.capture(
              expertSelection!.plugins,
            ),
          };
      if (bound)
        await service.pluginConnections.requireConfigured(
          bound.plugins || [],
          bound.extensionSnapshot?.config,
        );
      // Recheck after asynchronous preparation. A reservation is the per-thread
      // fence even while the first request is still preparing its private inputs.
      if (
        !runs.get(p.requestId) &&
        p.threadId &&
        db.raw
          .prepare(
            "SELECT 1 FROM runs WHERE thread_id=? AND state IN ('reserved','awaiting_credentials','dispatching','unknown')",
          )
          .get(p.threadId)
      )
        return reply
          .code(409)
          .send({ error: "此会话有待处理的发送，请先确认或取消。" });
      const { run, fresh } = runs.reserve(p.requestId, p);
      ownsReservation = fresh;
      if (runningRequests.has(p.requestId))
        return runningRequests.get(p.requestId);
      if (!fresh) {
        if (run.turn_id || run.state === "awaiting_credentials")
          return {
            ...runs.view(run),
            privateInputs: privateFieldStore.pending(p.requestId),
          };
        return reply.code(409).send({
          ...runs.view(run),
          error: "该请求可能已经提交，请查询请求状态；系统不会重复执行",
        });
      }
      db.raw
        .prepare("INSERT INTO run_context VALUES(?,?)")
        .run(p.requestId, JSON.stringify(bound));
      files.bind(p.requestId, p.attachments);
      service.experts.bind(p.requestId, bound!.expertSnapshot);
      const raw = (await service.configuration.read()).response.config;
      const privateConfig = {
        ...raw,
        ...(bound?.providerConfigRevision
          ? runtime.providerRuntime?.snapshot(bound.providerConfigRevision)
              .values
          : {}),
        ...(bound?.extensionSnapshot?.config || {}),
      };
      privateFieldStore.bind({
        runId: p.requestId,
        threadId: run.thread_id || undefined,
        provider:
          bound?.provider || p.provider || raw.model_provider || "openai",
        config: privateConfig,
      });
      let holding = false;
      const execute = () =>
        traces.operation("bridge.agent.run", async () => {
          let threadId = run.thread_id;
          let dispatched = false;
          try {
            if (!threadId) {
              const thread = (await service.handle("thread/start", {
                ...bound,
                privateRunId: p.requestId,
              })) as Thread;
              threadId = thread.id;
              runs.update(p.requestId, "reserved", threadId);
              privateFieldStore.assign(p.requestId, threadId);
              // Creation already carried these private parameters. Empty native threads
              // cannot be unloaded/resumed before their first persisted turn.
              runtime.privateRevisions.set(
                threadId,
                privateFieldStore.version(threadId),
              );
            }
            privateFieldStore.assign(p.requestId, threadId);
            service.activity.prepare(threadId, p.requestId);
            const result = (await service.handle("turn/start", {
              ...p,
              ...bound,
              ...(run.thread_id ? {} : { runtimeRevision: undefined }),
              threadId,
              clientUserMessageId: run.client_message_id,
              onDispatch: (
                refs: SkillReference[],
                plugins: import("../shared/types.js").PluginReference[],
              ) => {
                service.skillUses.bind(p.requestId, refs);
                service.pluginUses.bind(p.requestId, plugins);
                service.inputs.consume(threadId!, bound?.inputRevision);
                runs.update(p.requestId, "dispatching", threadId!);
                dispatched = true;
              },
            })) as Json;
            runs.update(p.requestId, "accepted", threadId, result.turn.id);
            return { ...runs.view(runs.get(p.requestId)!), turn: result.turn };
          } catch (e) {
            if (threadId)
              service.activity.rejected(threadId, p.requestId, dispatched);
            if (!dispatched) {
              files.unbind(p.requestId);
              service.skillUses.unbind(p.requestId);
              service.pluginUses.unbind(p.requestId);
              service.experts.unbind(p.requestId);
            }
            if (!runs.get(p.requestId)?.turn_id)
              runs.update(
                p.requestId,
                dispatched ? "unknown" : "rejected",
                threadId || undefined,
              );
            privateFieldStore.finish(p.requestId);
            db.audit(
              "agent/run",
              p.requestId,
              dispatched ? "unknown" : "rejected",
            );
            throw e;
          }
        });
      const operationStart = async () => {
        try {
          return await execute();
        } finally {
          if (holding) releaseProviderConfig?.();
        }
      };
      if (privateFieldStore.pending(p.requestId).length) {
        // A new thread is allocated only after authorization; its grant is attached
        // atomically to the resulting native identity before the first turn.
        runs.update(p.requestId, "awaiting_credentials");
        holding = true;
        waitingRuns.set(p.requestId, {
          start: operationStart,
          expires: Date.now() + 30 * 60_000,
          cancel: () => {
            runs.update(p.requestId, "rejected");
            privateFieldStore.finish(p.requestId);
            files.unbind(p.requestId);
            service.skillUses.unbind(p.requestId);
            service.pluginUses.unbind(p.requestId);
            service.experts.unbind(p.requestId);
            releaseProviderConfig?.();
          },
        });
        return {
          ...runs.view(runs.get(p.requestId)!),
          privateInputs: privateFieldStore.pending(p.requestId),
        };
      }
      const operation = operationStart();
      runningRequests.set(p.requestId, operation);
      try {
        return await operation;
      } finally {
        runningRequests.delete(p.requestId);
      }
    } catch (error) {
      if (ownsReservation && runs.get(p.requestId)?.state === "reserved") {
        runs.update(p.requestId, "rejected");
        privateFieldStore.finish(p.requestId);
        files.unbind(p.requestId);
        service.experts.unbind(p.requestId);
      }
      throw error;
    } finally {
      if (!waitingRuns.has(p.requestId)) releaseProviderConfig?.();
    }
  });
  const actions = new Set([
    "configuration/recover",
    "gateway/catalog",
    "gateway/defaults",
    "session/update",
    "session/extensions",
    "session/inputs",
    "expert/list",
    "expert/read",
    "expert/save",
    "expert/delete",
    "runtime/presets",
    "skills/uninstall",
    "plugin/list",
    "plugin/read",
    "plugin/skill/read",
    "plugin/skill/enabled",
    "plugin/connection/test",
    "plugin/install",
    "plugin/update",
    "plugin/uninstall",
    "plugin/enabled",
    "bridge/status",
    "bridge/restart",
    "bridge/maintenance",
    "provider/switch",
    "provider/models",
    "provider/test",
    "thread/resume",
    "thread/name/set",
    "thread/archive",
    "turn/interrupt",
    "approval/list",
    "approval/respond",
    "elicitation/respond",
    "mcp/oauth",
    "mcp/reload",
    "mcp/test",
  ]);
  app.post("/api/agent/action", async (req) => {
    const p = z
      .object({ action: z.string().max(80) })
      .passthrough()
      .parse(req.body);
    if (!actions.has(p.action)) throw new PublicError("不支持的控制操作");
    const result = await traces.operation("bridge.agent.action", () =>
      p.action === "gateway/defaults"
        ? configOperations.run(
            req.headers["x-newbot-operation-id"],
            hash(req.cookies.ma_session!),
            p,
            () => service.handle(p.action, p),
          )
        : service.handle(p.action, p),
    );
    if (p.action === "thread/archive") {
      const id = z.string().parse(p.threadId);
      privateFieldStore.revoke(id);
      for (const [runId, held] of waitingRuns)
        if (runs.get(runId)?.thread_id === id) {
          waitingRuns.delete(runId);
          held.cancel();
        }
      for (const [requestId, entry] of authorizationRequests)
        if (entry.threadId === id) {
          authorizationRequests.delete(requestId);
          privateFieldStore.finish(requestId);
        }
    }
    return result;
  });
  app.post("/api/mcp-apps/:action", async (req) => {
    const action = (req.params as { action: string }).action;
    const methods: Record<string, string> = {
      open: "app/open",
      "call-request": "app/call/request",
      "call-approve": "app/call/approve",
      "call-cancel": "app/call/cancel",
      close: "app/close",
      status: "app/status",
    };
    if (!methods[action]) throw new PublicError("不支持的应用操作");
    const p = z.record(z.string(), z.unknown()).parse(req.body);
    const mainOrigin = req.headers.origin!;
    const appOrigin = isolatedOrigin(mainOrigin);
    if (action === "open" && !appOrigin)
      throw new PublicError("请为 MCP Apps 配置独立的 APP_ORIGIN");
    const value = (await service.handle(methods[action], p, {
      sessionId: hash(req.cookies.ma_session!),
    })) as Json;
    if (action === "open") {
      for (const [key, doc] of documents)
        if (doc.expires < Date.now()) documents.delete(key);

      documents.set(value.token, {
        html: value.html,
        expires: value.expiresAt,
      });
      const { html, ...rest } = value;
      return { ...rest, url: `${appOrigin}/sandbox/${value.token}` };
    }
    return value;
  });
  app.get("/sandbox/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const document = documents.get(token);
    const lease = service.apps.live(token);
    const validSession =
      !lease?.owner ||
      !!db.raw
        .prepare("SELECT 1 FROM sessions WHERE token=? AND expires>?")
        .get(lease.owner, Date.now());
    if (
      !document ||
      document.expires <= Date.now() ||
      !lease ||
      !validSession
    ) {
      if (lease) service.apps.close(token, lease.owner);
      documents.delete(token);
      return reply.code(404).send("App resource expired");
    }
    return reply.type("text/html; charset=utf-8").send(document.html);
  });
  app.post("/api/attachments", async (req) => {
    const { name } = z
      .object({ name: z.string().min(1).max(300) })
      .parse(req.query);
    if (!Buffer.isBuffer(req.body))
      throw new PublicError("使用 application/octet-stream 上传");
    return files.save(name, req.body);
  });
  app.get("/api/workspace/files", async (req) => {
    const { path, offset, threadId } = z
      .object({
        threadId: z.string().min(1).max(200),
        path: z.string().max(1024).default(""),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .parse(req.query);
    return artifacts.workspaceFiles(path, offset, threadId);
  });
  app.get("/api/threads/:id/artifacts", async (req) => {
    const { id } = req.params as { id: string };
    const { turnId } = z
      .object({ turnId: z.string().min(1).max(200).optional() })
      .parse(req.query);
    return {
      artifacts: artifacts.list(id, turnId),
      notices: artifacts
        .notices(id)
        .filter((n) => !turnId || n.turnId === turnId),
    };
  });
  app.post("/api/threads/:id/artifacts", async (req) => {
    const { id } = req.params as { id: string };
    const { turnId, path } = z
      .object({
        turnId: z.string().min(1).max(200),
        path: z.string().min(1).max(1024),
      })
      .strict()
      .parse(req.body);
    // Membership is checked before any native history or filesystem access.
    if (!db.owns(id)) throw new PublicError("会话不存在");
    let thread = await service.read(id);
    let found = thread.turns.some((t) => t.id === turnId);
    for (let page = 1; !found && thread.historyCursor && page < 20; page++) {
      thread = await service.read(id, thread.historyCursor);
      found = thread.turns.some((t) => t.id === turnId);
    }
    if (!found)
      throw new PublicError("当前历史中找不到该轮对话，请加载对应记录后重试");
    const value = await artifacts.register(id, turnId, path);
    artifactsChanged(id);
    return value;
  });
  app.post("/api/artifacts/:id/preview", async (req) => {
    const appOrigin = isolatedOrigin(req.headers.origin!);
    if (!appOrigin) throw new PublicError("此实例尚未配置独立的 HTML 预览地址");
    return previews.issue(
      (req.params as { id: string }).id,
      req.cookies.ma_session!,
      appOrigin,
      req.headers.origin!,
    );
  });
  app.delete("/api/artifacts/:id/preview/:previewId", async (req) => {
    const { id, previewId } = req.params as { id: string; previewId: string };
    previews.revoke(previewId, id, req.cookies.ma_session!);
    return { ok: true };
  });
  app.get("/artifact-preview/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const grant = previews.find(token, req.headers.host || "");
    if (!grant)
      return reply
        .code(410)
        .type("text/html; charset=utf-8")
        .send(previewFailure(token));
    const shell = previewShell(grant);
    return reply
      .type("text/html; charset=utf-8")
      .header("Content-Security-Policy", shell.policy)
      .header("Connection-Allowlist", shell.allowlist)
      .send(shell.html);
  });
  app.get("/artifact-content/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    // The opaque wrapper has no serializable origin; the short-lived capability
    // authorizes this inner document. The outer shell still restricts its ancestors.
    reply.header("Content-Security-Policy", CONTENT_POLICY);
    const grant = previews.find(token, req.headers.host || "");
    if (!grant)
      return reply
        .code(410)
        .type("text/html; charset=utf-8")
        .send(previewFailure(token));
    try {
      const { data } = await artifacts.read(grant.artifactId);
      if (!previews.find(token, req.headers.host || ""))
        return reply
          .code(410)
          .type("text/html; charset=utf-8")
          .send(previewFailure(token));
      return reply
        .type("text/html; charset=utf-8")
        .send(previewContent(data.toString("utf8"), token));
    } catch {
      return reply
        .code(410)
        .type("text/html; charset=utf-8")
        .send(previewFailure(token));
    }
  });
  app.get("/api/storage", async () => (await artifacts.maintenance()).usage);
  app.post("/api/storage/cleanup", async () =>
    artifacts.maintenance(true, () => files.cleanup()),
  );
  app.get("/api/artifacts/:id/versions", async (req) => {
    const { before } = z
      .object({
        before: z.coerce
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
      })
      .parse(req.query);
    return artifacts.versions((req.params as { id: string }).id, before);
  });
  pdfRoutes(app, artifacts);
  app.get("/api/artifacts/:id", async (req) =>
    artifacts.get((req.params as { id: string }).id),
  );
  for (const action of ["content", "download"] as const)
    app.get(`/api/artifacts/:id/${action}`, async (req, reply) => {
      const { artifact, data } = await artifacts.read(
        (req.params as { id: string }).id,
      );
      // HTML, JS, SVG and PDF never execute at the trusted chat origin.
      const image = artifact.kind === "image" && action === "content";
      reply
        .type(
          image
            ? artifact.mime
            : action === "content" && !["image", "pdf"].includes(artifact.kind)
              ? "text/plain; charset=utf-8"
              : "application/octet-stream",
        )
        .header(
          "Content-Disposition",
          `${image || (action === "content" && !["image", "pdf"].includes(artifact.kind)) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
        )
        .header("Cache-Control", "private, no-store")
        .header("Content-Security-Policy", "sandbox; default-src 'none'");
      return data;
    });
  app.get("/api/files/:id", async (req, reply) => {
    const value = files.read((req.params as { id: string }).id);
    reply
      .type(value.mime)
      .header(
        "Content-Disposition",
        `${value.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(value.name)}`,
      );
    return value.data;
  });
  app.get("/api/agent/events", async (req, reply) => {
    const { threadId, transport, cursor } = z
      .object({
        threadId: z.string().max(200).optional(),
        transport: z.enum(["poll", "sse"]).optional(),
        cursor: z.string().max(100).optional(),
      })
      .parse(req.query);
    if (threadId && !db.owns(threadId))
      return reply.code(404).send({ error: "会话不存在" });
    if (transport === "poll") return feed.read(cursor, threadId);
    if (
      streams.size >= 20 ||
      [...streams.values()].filter((s) => s.session === req.cookies.ma_session)
        .length >= 5
    )
      return reply
        .code(429)
        .send({ error: "实时连接过多，请关闭多余的标签页" });
    const res = reply.raw;
    reply.hijack();
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    res.write("retry: 1500\n\n");
    streams.set(res, { session: req.cookies.ma_session!, threadId });
    res.on("close", () => streams.delete(res));
    write(res, {
      type: EventType.CUSTOM,
      name: "newbot.runtime",
      value: { state: runtime.state, reason: runtime.reason },
    });
    for (const approval of service.elicitation.list())
      write(res, {
        type: EventType.CUSTOM,
        name: "newbot.approval.request",
        value: approval,
      });
    write(res, service.activity.snapshot());
    for (const id of service.events.threads.keys())
      if (!threadId || id === threadId) write(res, service.events.snapshot(id));
  });
  const cleanup = setInterval(() => {
    try {
      void artifacts
        .maintenance(true, () => files.cleanup())
        .catch(() => operational("storage.cleanup", "failed"));
    } catch {
      operational("storage.cleanup", "failed");
    }
  }, 3600000);
  cleanup.unref();
  const heartbeat = setInterval(() => {
    for (const [id, entry] of authorizationRequests)
      if (entry.expires < Date.now()) {
        authorizationRequests.delete(id);
        privateFieldStore.finish(id);
      }
    for (const [id, held] of waitingRuns)
      if (held.expires < Date.now()) {
        waitingRuns.delete(id);
        held.cancel();
      }
    for (const [res, { session }] of streams) {
      if (!db.validSession(session)) res.end();
      else if (!res.writableEnded) res.write(": heartbeat\n\n");
    }
  }, 20000);
  heartbeat.unref();
  const root = resolve(options.webDirectory || "dist/web");
  if (existsSync(root)) {
    await app.register(staticFiles, {
      root,
      wildcard: true,
      preCompressed: true,
      setHeaders(res, path) {
        // WASM is enabled only in the separately fetched, owned PDF worker.
        if (/\/pdf\.worker\.min-[\w-]+\.mjs(?:\.(?:br|gz))?$/.test(path))
          res.header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'",
          );
        res.header(
          "Cache-Control",
          path.includes("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/") ||
      req.url.startsWith("/assets/") ||
      /^\/(?:sandbox|artifact-preview|artifact-content)\//.test(req.url)
        ? reply.code(404).send({ error: "Not found" })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("preClose", async () => {
    for (const res of streams.keys()) res.end();
  });
  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    clearInterval(cleanup);
    for (const held of waitingRuns.values()) held.cancel();
    waitingRuns.clear();
    credentials.close();
    vault.close();
    await imports.close();
    service.elicitation.close();
    service.ui.close();
    previews.clear();
    runtime.removeAllListeners();
    await runtime.stopAndWait();
    await media.close();
    await artifacts.close();
    await traces.close();
    nodeControl?.close();
    db.raw.close();
    await lease.release(true);
  });
  return {
    app,
    runtime,
    db,
    service,
    artifacts,
    imports,
    previews,
    credentials,
    privateFields: privateFieldStore,
    vault,
    workspaces: workspaceStore,
    nodeControl,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { app, runtime } = await createServer();
  await app.listen({
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3100),
  });
  console.log(
    `newbot: http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3100}`,
  );
  void runtime.start();
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => void app.close().then(() => process.exit(0)));
}

function operational(event: string, status: string, fields: Json = {}) {
  if (process.env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT)
    process.stdout.write(
      JSON.stringify({
        at: new Date().toISOString(),
        event,
        status,
        ...fields,
      }) + "\n",
    );
}
function safeError(error: unknown) {
  return publicErrorMessage(error);
}
