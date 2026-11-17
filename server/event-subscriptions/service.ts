import { webhookDelivery, type RelayConfiguration } from "./webhook.js";
import { join } from "node:path";
import { z } from "zod";
import type { Store } from "../db.js";
import type { credentialVault } from "../credential-vault.js";
import type { automations } from "../automations.js";
import type { ExtensionRuntime } from "../extension-runtime.js";
import { importTree } from "../import-files.js";
import { PublicError } from "../public-error.js";
import {
  eventPackageSchema,
  eventAccountSave,
  type EventCatalog,
  type EventProviderView,
} from "../../shared/event-subscriptions.js";
import type { AutomationInput } from "../../shared/automations.js";
import {
  hash,
  canonical,
  ProviderRegistry,
  SourceFailure,
  type Subscription,
} from "./contracts.js";
import { SubscriptionEngine } from "./engine.js";
import { legacyManifest, legacyEvents, legacyAdapter } from "./legacy.js";
import { eventOAuth } from "./oauth.js";
import {
  pluginDescriptors,
  resolvePluginConfiguration,
  type PluginDescriptor,
} from "../plugin-descriptor.js";
import {
  openEventConnection,
  type OpenEventConnection,
  type EventPeer,
} from "./connection.js";
import { discoverEvents, mcpEventAdapter } from "./mcp-adapter.js";
import { schemaValidator } from "../../shared/event-schema.js";

type Account = {
  id: string;
  revision: number;
  provider_id: string;
  binding: string;
  label: string;
  packet: string;
  has_token: number;
  generation: number;
};
type Provider = EventProviderView & {
  binding: string;
  adapter: string;
  descriptor?: PluginDescriptor;
};
export function eventSubscriptions(
  db: Store,
  vault: Pick<
    ReturnType<typeof credentialVault>,
    "sealPrivate" | "openPrivate"
  >,
  tasks: ReturnType<typeof automations>,
  extensions?: ExtensionRuntime,
  options: {
    relay?: RelayConfiguration;
    callback?: string;
    request?: typeof fetch;
    now?: () => number;
    connect?: OpenEventConnection;
    existing?: (descriptor: PluginDescriptor) =>
      | {
          revision: string;
          values: Record<string, string | number | boolean>;
          secrets: Record<string, string>;
          caCertificate?: string;
        }
      | undefined;
  } = {},
) {
  const providers = new Map<string, Provider>();
  const discovery = new Map<
    string,
    { descriptor: PluginDescriptor; binding: string }
  >();
  const account = (id: string) =>
    db.raw
      .prepare("SELECT * FROM automation_event_accounts WHERE id=?")
      .get(id) as Account | undefined;
  const accounts = () =>
    db.raw
      .prepare("SELECT * FROM automation_event_accounts ORDER BY label,id")
      .all() as Account[];
  const binding = (a: Account) =>
    `newbot:events:${a.id}:${a.revision}:${a.binding}`;
  const registry = new ProviderRegistry(
    new Map([
      [
        "legacy-v1",
        legacyAdapter((connection) => {
          const [id, revision] = connection.split(".");
          const a = account(id);
          if (
            !a ||
            String(a.generation) !== revision ||
            providers.get(a.provider_id)?.binding !== a.binding
          )
            throw new SourceFailure("auth_required");
          const bytes = vault.openPrivate(a.packet, binding(a));
          try {
            return bytes.toString("utf8");
          } finally {
            bytes.fill(0);
          }
        }, options.request),
      ],
    ]),
  );
  const peers = new Map<string, Promise<EventPeer>>();
  const unpack = (a: Account) => {
    const bytes = vault.openPrivate(a.packet, binding(a));
    try {
      if (providers.get(a.provider_id)?.legacy)
        return { values: {}, secrets: { token: bytes.toString("utf8") } };
      const data = z
        .object({
          values: z.record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean()]),
          ),
          secrets: z.record(z.string(), z.string()),
          linkedRevision: z.string().optional(),
        })
        .parse(JSON.parse(bytes.toString("utf8")));
      if (data.linkedRevision !== undefined) {
        const descriptor = providers.get(a.provider_id)?.descriptor;
        const existing = descriptor && options.existing?.(descriptor);
        if (!existing || existing.revision !== data.linkedRevision)
          throw new SourceFailure("auth_required");
        return { ...data, ...existing };
      }
      return data;
    } finally {
      bytes.fill(0);
    }
  };
  const oauth = eventOAuth(
    db,
    vault,
    (id) => {
      const a = account(id),
        p = a && (providers.get(a.provider_id) || discovery.get(a.provider_id));
      if (!a || !p?.descriptor || p.binding !== a.binding)
        throw new PublicError("事件账号不可用");
      const { definition } = resolvePluginConfiguration(
        p.descriptor,
        unpack(a).values,
      );
      if (!definition.url) throw new PublicError("此连接不支持 OAuth");
      return {
        id,
        binding: a.binding,
        generation: a.generation,
        url: definition.url,
        caCertificate: (unpack(a) as { caCertificate?: string }).caCertificate,
        clientId: definition.oauth?.client_id,
        scopes: definition.scopes,
      };
    },
    options.callback || "http://127.0.0.1:3100/oauth/events/callback",
  );
  const connect = async (connection: string, scope = "") => {
    const [id, generation] = connection.split(".");
    const a = account(id),
      p = a && providers.get(a.provider_id);
    if (
      !a ||
      String(a.generation) !== generation ||
      !p?.descriptor ||
      p.binding !== a.binding
    )
      throw new SourceFailure("auth_required");
    const configuration = unpack(a);
    const key = connection + ":" + a.binding + ":" + hash(scope);
    let peer = peers.get(key);
    if (!peer) {
      peer = (options.connect || openEventConnection)({
        descriptor: p.descriptor,
        ...configuration,
        ...(p.oauth ? { authProvider: oauth.provider(a.id) } : {}),
      });
      peers.set(key, peer);
      peer.catch(() => peers.delete(key));
    }
    return peer;
  };
  const webhook = options.relay
    ? webhookDelivery(db, vault, options.relay, connect)
    : undefined;
  const resources = (t: AutomationInput["eventTriggers"][number]) => {
    const p = providers.get(t.providerId!);
    if (p?.legacy) return [t.repository.toLowerCase()];
    return (t.events.length ? t.events : p?.events.map((e) => e.id) || []).map(
      (name) => canonical({ name, arguments: t.arguments || {} }),
    );
  };
  const engine = new SubscriptionEngine({
    directory: join(db.directory, "event-subscriptions"),
    registry,
    now: options.now,
    pollMs: 60000,
    timeoutMs: 15000,
    maxEvents: 100000,
    deliver: async (target, event, id) => {
      await refresh();
      const task = tasks.list().find((t) => t.id === target.taskId);
      const trigger = task?.eventTriggers.find(
        (t) => t.id === target.triggerId && t.source === "subscription",
      );
      const a = trigger?.connectionId && account(trigger.connectionId);
      if (
        !task?.enabled ||
        task.revision !== target.revision ||
        !trigger ||
        !a ||
        a.provider_id !== trigger.providerId ||
        providers.get(a.provider_id)?.binding !== a.binding ||
        !resources(trigger).some(
          (resource) =>
            target.binding === hash([a.binding, a.id, a.generation, resource]),
        )
      )
        return "discarded";
      try {
        unpack(a);
      } catch {
        return "discarded";
      }
      tasks.receiveEvent(target.taskId, target.revision, target.triggerId, {
        id,
        digest: hash(event),
        source: "subscription",
        type: event.type,
        payload: event.payload,
      });
      return "accepted";
    },
  });
  let refreshing: Promise<void> | undefined;
  function refresh() {
    return (refreshing ??= (async () => {
      const found = new Map<string, Provider>();
      const packages = db.raw
        .prepare(
          "SELECT name,path,digest,content FROM extension_packages WHERE kind='plugin'",
        )
        .all() as {
        name: string;
        path: string;
        digest: string;
        content: string;
      }[];
      for (const p of packages) {
        const metadata = JSON.parse(p.content);
        const pluginId = metadata.pluginId || `${p.name}@newbot-imports`;
        if (
          metadata.installed === false ||
          extensions?.pluginEnabled(pluginId, true) === false
        )
          continue;
        try {
          const tree = await importTree(p.path);
          if (tree.digest !== p.digest) continue;
          const file = tree.files.find((f) => f.path === "newbot-events.json");
          if (!file || file.data.length > 16384) continue;
          const raw = JSON.parse(file.data.toString("utf8"));
          const legacy = raw.version === 1;
          const manifest = legacy
            ? legacyManifest.parse(raw)
            : eventPackageSchema.parse(raw);
          const descriptors = legacy
            ? []
            : await pluginDescriptors(pluginId, p.path, p.digest);
          for (const source of manifest.sources) {
            const id = hash([pluginId, source.id]);
            const descriptor =
              !legacy && "server" in source
                ? descriptors.find((d) => d.name === source.server)
                : undefined;
            let events: EventProviderView["events"] = legacy
              ? legacyEvents
              : [];
            let state: string | undefined;
            if (!legacy) {
              if (!descriptor || descriptor.reason) {
                state = "unavailable";
              } else if (
                providers.get(id)?.binding === hash([p.digest, source])
              )
                events = providers.get(id)!.events;
              else {
                discovery.set(id, {
                  descriptor,
                  binding: hash([p.digest, source]),
                });
                let peer: EventPeer | undefined;
                try {
                  const a = accounts().find(
                    (a) =>
                      a.provider_id === id &&
                      a.binding === hash([p.digest, source]),
                  );
                  let configuration = {
                    values: Object.fromEntries(
                      descriptor.fields
                        .filter((f) => !f.sensitive && f.default !== undefined)
                        .map((f) => [f.id, f.default]),
                    ),
                    secrets: {},
                  };
                  if (a) {
                    const bytes = vault.openPrivate(a.packet, binding(a));
                    try {
                      configuration = JSON.parse(bytes.toString("utf8"));
                    } finally {
                      bytes.fill(0);
                    }
                  }
                  const existing = options.existing?.(descriptor);
                  if ((configuration as any).linkedRevision !== undefined) {
                    if (
                      existing?.revision !==
                      (configuration as any).linkedRevision
                    )
                      throw new SourceFailure("auth_required");
                    configuration = existing!;
                  }
                  peer = await (options.connect || openEventConnection)({
                    descriptor,
                    ...configuration,
                    ...(a &&
                    (descriptor.definition.oauth ||
                      ("authentication" in source &&
                        source.authentication === "oauth"))
                      ? { authProvider: oauth.provider(a.id) }
                      : {}),
                  });
                  events = (await discoverEvents(peer)).map((e) => ({
                    id: e.name,
                    label: e.title || e.name,
                    inputSchema: e.inputSchema,
                    delivery: e.delivery,
                  }));
                } catch {
                  state = "auth_required";
                } finally {
                  await peer?.close();
                  discovery.delete(id);
                }
              }
            }
            found.set(id, {
              id,
              label: source.label,
              pluginId,
              binding: hash([p.digest, source]),
              adapter: legacy ? "legacy-v1" : id,
              descriptor,
              legacy,
              state,
              reusableConnection:
                !!descriptor && !!options.existing?.(descriptor),
              oauth:
                !!descriptor?.definition.oauth ||
                ("authentication" in source &&
                  source.authentication === "oauth"),
              fields: descriptor?.fields || [
                {
                  id: "token",
                  type: "string",
                  title: "访问令牌",
                  required: false,
                  sensitive: true,
                },
              ],
              events,
            });
          }
        } catch {
          db.audit("automation/source", pluginId, "unavailable");
        }
      }
      for (const [id, p] of providers)
        if (found.get(id)?.binding !== p.binding) {
          engine.uninstall(id);
          for (const a of accounts().filter((a) => a.provider_id === id))
            invalidate(a.id);
          providers.delete(id);
          for (const task of tasks.list())
            if (
              task.enabled &&
              task.eventTriggers.some((t) => t.providerId === id)
            )
              tasks.control(task.id, task.revision, "pause");
        }
      for (const [id, p] of found)
        if (!providers.has(id)) {
          if (!p.legacy)
            registry.registerAdapter(p.id, mcpEventAdapter(connect, webhook));
          if (!p.events.length) {
            providers.set(id, p);
            continue;
          }
          const registered = registry.install({
            version: 1,
            pluginId: "installed",
            source: {
              id,
              label: p.label,
              adapter: p.adapter,
              events: p.events.map((e) => e.id),
            },
          });
          registry.alias(id, registered);
          providers.set(id, p);
        }
      for (const task of tasks.list())
        if (
          task.enabled &&
          task.eventTriggers.some((t) => {
            if (t.source !== "subscription") return false;
            const a = account(t.connectionId!);
            return (
              !a ||
              a.provider_id !== t.providerId ||
              providers.get(a.provider_id)?.binding !== a.binding
            );
          })
        )
          tasks.control(task.id, task.revision, "pause");
    })().finally(() => {
      refreshing = undefined;
    }));
  }
  async function catalog(): Promise<EventCatalog> {
    await refresh();
    return {
      providers: [...providers.values()].map(
        ({ binding, adapter, descriptor, ...p }) => p,
      ),
      accounts: accounts().map((a) => ({
        id: a.id,
        revision: a.revision,
        providerId: a.provider_id,
        label: a.label,
        hasToken: !!a.has_token,
        available:
          providers.get(a.provider_id)?.binding === a.binding &&
          (() => {
            try {
              unpack(a);
              return true;
            } catch {
              return false;
            }
          })(),
        ...(() => {
          try {
            const data = unpack(a);
            return {
              values: data.values,
              secretFields: Object.keys(data.secrets),
            };
          } catch {
            return {};
          }
        })(),
      })),
    };
  }
  function invalidate(id: string) {
    for (const [key, peer] of peers)
      if (key.startsWith(id + ".")) {
        peers.delete(key);
        void peer.then((p) => p.close()).catch(() => {});
      }
    for (const row of engine.configurations())
      if (row.config.connectionId.split(".")[0] === id)
        engine.setEnabled(row.id, false);
  }
  async function saveAccount(input: unknown) {
    const p = eventAccountSave.parse(input);
    await refresh();
    const provider = providers.get(p.providerId);
    if (!provider) throw new PublicError("应用不可用，请重新安装或启用");
    const old = account(p.id);
    if ((old?.revision || 0) !== p.revision)
      throw new PublicError("账号配置已变化，请重新打开后重试");
    if (old && old.provider_id !== p.providerId)
      throw new PublicError("账号不能改为其他应用，请添加账号");
    if (
      old &&
      old.binding !== provider.binding &&
      p.token === undefined &&
      p.secrets === undefined
    )
      throw new PublicError("应用已更新，请重新确认连接配置");
    let discovered: EventProviderView["events"] | undefined;
    let needsAuthorization = false;
    let secret: Buffer;
    if (provider.legacy) {
      if (p.token === undefined && old)
        secret = vault.openPrivate(old.packet, binding(old));
      else secret = Buffer.from(p.token || "");
    } else {
      const previous =
        old && old.binding === provider.binding
          ? unpack(old)
          : { values: {}, secrets: {} };
      const existing =
        provider.descriptor && options.existing?.(provider.descriptor);
      const linked =
        p.reuseConnection ??
        ("linkedRevision" in previous &&
          previous.linkedRevision !== undefined &&
          p.values === undefined &&
          p.secrets === undefined);
      if (linked && !existing)
        throw new PublicError("插件连接尚未配置，请先在插件设置中完成连接");
      const data = linked
        ? { values: existing!.values, secrets: existing!.secrets }
        : {
            values: p.values ?? previous.values,
            secrets: { ...previous.secrets, ...p.secrets },
          };
      const fields = provider.fields || [];
      if (
        Object.keys(data.values).some(
          (k) => !fields.some((f) => f.id === k && !f.sensitive),
        ) ||
        Object.keys(data.secrets).some(
          (k) => !fields.some((f) => f.id === k && f.sensitive),
        )
      )
        throw new PublicError("连接包含未声明的字段");
      for (const field of fields) {
        const value = field.sensitive
          ? data.secrets[field.id]
          : data.values[field.id];
        if (field.required && (value === undefined || value === ""))
          throw new PublicError("请填写" + field.title);
        if (value !== undefined && typeof value !== field.type)
          throw new PublicError("连接字段类型不正确");
      }
      secret = Buffer.from(
        JSON.stringify(
          linked
            ? { values: {}, secrets: {}, linkedRevision: existing!.revision }
            : data,
        ),
      );
      let peer: EventPeer | undefined;
      try {
        peer = await (options.connect || openEventConnection)({
          descriptor: provider.descriptor!,
          ...data,
          ...(linked ? { caCertificate: existing!.caCertificate } : {}),
        });
        const events = await discoverEvents(peer);
        if (!events.length) throw new PublicError("应用没有可订阅事件");
        if (
          (account(p.id)?.revision || 0) !== p.revision ||
          providers.get(p.providerId)?.binding !== provider.binding
        )
          throw new PublicError("连接已变化，请重新打开后重试");
        discovered = events.map((e) => ({
          id: e.name,
          label: e.title || e.name,
          inputSchema: e.inputSchema,
          delivery: e.delivery,
        }));
        await refresh();
        if (providers.get(p.providerId)?.binding !== provider.binding)
          throw new PublicError("应用已变化，请重新打开后重试");
      } catch (error) {
        if (
          !provider.oauth ||
          !(error instanceof SourceFailure) ||
          error.code !== "auth_required"
        ) {
          secret.fill(0);
          throw error;
        }
        needsAuthorization = true;
      } finally {
        await peer?.close();
      }
    }
    if ((account(p.id)?.revision || 0) !== p.revision) {
      secret.fill(0);
      throw new PublicError("账号配置已变化，请重新打开后重试");
    }
    let sameCredential = !!old && old.binding === provider.binding;
    if (sameCredential && old) {
      const previous = vault.openPrivate(old.packet, binding(old));
      try {
        sameCredential = secret.equals(previous);
      } finally {
        previous.fill(0);
      }
    }
    const next: Account = {
      id: p.id,
      revision: p.revision + 1,
      provider_id: p.providerId,
      binding: provider.binding,
      label: p.label,
      packet: "",
      has_token: provider.legacy
        ? secret.length
          ? 1
          : 0
        : Object.values(JSON.parse(secret.toString()).secrets).some(Boolean)
          ? 1
          : 0,
      generation: old ? old.generation + (sameCredential ? 0 : 1) : 1,
    };
    try {
      next.packet = vault.sealPrivate(secret, binding(next));
    } finally {
      secret.fill(0);
    }
    db.raw
      .prepare(
        "INSERT INTO automation_event_accounts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,binding=excluded.binding,label=excluded.label,packet=excluded.packet,has_token=excluded.has_token,generation=excluded.generation",
      )
      .run(
        next.id,
        next.revision,
        next.provider_id,
        next.binding,
        next.label,
        next.packet,
        next.has_token,
        next.generation,
      );
    if (discovered) {
      provider.events = discovered;
      provider.state = undefined;
      if (!registry.get(provider.id))
        registry.registerAdapter(
          provider.id,
          mcpEventAdapter(connect, webhook),
        );
      const registered = registry.install({
        version: 1,
        pluginId: "installed",
        source: {
          id: provider.id,
          label: provider.label,
          adapter: provider.id,
          events: discovered.map((e) => e.id),
        },
      });
      registry.alias(provider.id, registered);
    } else if (needsAuthorization) provider.state = "auth_required";
    if (!sameCredential) invalidate(p.id);
    db.audit("automation/account", p.id, "saved");
    return { id: next.id, revision: next.revision };
  }
  function removeAccount(input: unknown) {
    const p = z
      .strictObject({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
      })
      .parse(input);
    if (account(p.id)?.revision !== p.revision)
      throw new PublicError("账号配置已变化，请刷新后重试");
    invalidate(p.id);
    oauth.remove(p.id);
    db.raw
      .prepare("DELETE FROM automation_event_accounts WHERE id=?")
      .run(p.id);
    for (const task of tasks.list())
      if (
        task.enabled &&
        task.eventTriggers.some((t) => t.connectionId === p.id)
      )
        tasks.control(task.id, task.revision, "pause");
    db.audit("automation/account", p.id, "deleted");
    return { ok: true };
  }
  async function validate(input: AutomationInput) {
    if (!input.eventTriggers.some((t) => t.source === "subscription")) return;
    await refresh();
    for (const t of input.eventTriggers.filter(
      (t) => t.source === "subscription",
    )) {
      const a = account(t.connectionId!);
      const p = providers.get(t.providerId!);
      if (!a || !p || a.provider_id !== p.id || a.binding !== p.binding)
        throw new PublicError("请连接可用的事件账号");
      if (
        t.events.some((e) => !p.events.some((v) => v.id === e)) ||
        t.actions.length
      )
        throw new PublicError("请选择应用支持的事件");
      if (!p.legacy) {
        if (!t.events.length) throw new PublicError("请选择订阅事件");
        for (const name of t.events) {
          const event = p.events.find((e) => e.id === name)!;
          if (
            !event.delivery?.some(
              (mode) =>
                mode === "poll" ||
                mode === "push" ||
                (mode === "webhook" && !!webhook),
            )
          )
            throw new PublicError("此事件当前没有可用的交付方式");
          try {
            schemaValidator(event.inputSchema).parse(t.arguments || {});
          } catch {
            throw new PublicError("事件条件不完整或不受支持");
          }
        }
      }
    }
  }
  let timer: ReturnType<typeof setInterval> | undefined,
    work: Promise<void> | undefined,
    closed = false;
  function tick() {
    if (closed) return Promise.resolve();
    return (work ??= (async () => {
      if (
        !tasks
          .list()
          .some(
            (t) =>
              t.enabled &&
              t.eventTriggers.some((e) => e.source === "subscription"),
          ) &&
        !engine.configurations().some((r) => r.enabled) &&
        !peers.size
      ) {
        await webhook?.reconcile(new Set());
        return;
      }
      await refresh();
      const groups = new Map<string, Subscription>();
      for (const task of tasks.list())
        if (task.enabled)
          for (const t of task.eventTriggers) {
            if (t.source !== "subscription") continue;
            const a = account(t.connectionId!);
            const p = providers.get(t.providerId!);
            if (!a || !p || a.provider_id !== p.id || a.binding !== p.binding)
              continue;
            for (const resource of resources(t)) {
              const key = hash([p.id, a.id, a.generation, resource]);
              const group = groups.get(key) || {
                providerId: p.id,
                connectionId: `${a.id}.${a.generation}`,
                resource,
                targets: [],
              };
              group.targets.push({
                binding: hash([a.binding, a.id, a.generation, resource]),
                taskId: task.id,
                triggerId: t.id,
                revision: task.revision,
                events: t.events,
              });
              groups.set(key, group);
            }
          }
      await webhook?.reconcile(
        new Set([...groups.values()].map((g) => webhook.keyFor(g))),
      );
      const wanted = new Set<string>();
      for (const g of groups.values()) {
        const id = engine.subscribe(g);
        wanted.add(id);
        if (engine.inspect(id).state === "disabled") engine.reset(id);
      }
      for (const r of engine.configurations())
        if (r.enabled && !wanted.has(r.id)) engine.setEnabled(r.id, false);
      const activePeers = new Set(
        [...groups.values()].map((g) => {
          const a = account(g.connectionId.split(".")[0]);
          return (
            g.connectionId + ":" + (a?.binding || "") + ":" + hash(g.resource)
          );
        }),
      );
      for (const [key, peer] of peers)
        if (!activePeers.has(key)) {
          peers.delete(key);
          await peer.then((p) => p.close()).catch(() => {});
        }
      await engine.tick();
    })().finally(() => {
      work = undefined;
    }));
  }
  function status(taskId: string, triggerId: string) {
    const task = tasks.list().find((t) => t.id === taskId);
    const t = task?.eventTriggers.find((t) => t.id === triggerId);
    if (!task || !t || t.source !== "subscription")
      throw new PublicError("触发器不存在");
    const a = account(t.connectionId!);
    if (!task.enabled) return { state: "disabled" };
    if (!a || providers.get(a.provider_id)?.binding !== a.binding)
      return { state: "unavailable" };
    const row = engine
      .configurations()
      .find(
        (r) =>
          r.config.targets.some(
            (v) => v.taskId === taskId && v.triggerId === triggerId,
          ) &&
          r.config.connectionId === `${a.id}.${a.generation}` &&
          r.enabled,
      );
    if (!row) return { state: "pending" };
    const s = engine.inspect(row.id);
    return {
      state: s.cursor === null && s.state === "ready" ? "baseline" : s.state,
    };
  }
  async function retry(taskId: string, triggerId: string) {
    await refresh();
    const task = tasks.list().find((t) => t.id === taskId);
    if (!task?.enabled) throw new PublicError("请先恢复任务");
    await validate(task);
    for (const r of engine.configurations())
      if (
        r.enabled &&
        r.config.targets.some(
          (t) => t.taskId === taskId && t.triggerId === triggerId,
        )
      )
        engine.setEnabled(r.id, true);
    return { ok: true };
  }
  return {
    catalog,
    async oauthStart(id: string) {
      await refresh();
      return oauth.start(id);
    },
    async oauthComplete(query: Parameters<typeof oauth.complete>[0]) {
      await refresh();
      const result = await oauth.complete(query);
      invalidate(result.id);
      const a = account(result.id)!,
        p = providers.get(a.provider_id)!;
      const peer = await connect(`${a.id}.${a.generation}`);
      const events = await discoverEvents(peer);
      p.events = events.map((e) => ({
        id: e.name,
        label: e.title || e.name,
        inputSchema: e.inputSchema,
        delivery: e.delivery,
      }));
      p.state = undefined;
      if (!registry.get(p.id))
        registry.registerAdapter(p.id, mcpEventAdapter(connect, webhook));
      const registered = registry.install({
        version: 1,
        pluginId: "installed",
        source: {
          id: p.id,
          label: p.label,
          adapter: p.id,
          events: events.map((e) => e.name),
        },
      });
      registry.alias(p.id, registered);
      return { ok: true };
    },
    saveAccount,
    removeAccount,
    validate,
    tick,
    status,
    retry,
    start() {
      timer = setInterval(() => {
        void tick().catch(() =>
          db.audit("automation/subscription", "worker", "failed"),
        );
      }, 5000);
      timer.unref();
    },
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      await work;
      await engine.close();
      await Promise.allSettled(
        [...peers.values()].map(async (p) => (await p).close()),
      );
      peers.clear();
    },
  };
}
