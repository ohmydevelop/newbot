import { followupService } from "./followups.js";
import { restoreFailures } from "./failure-store.js";
import { presentationInstructions } from "./presentation.js";
import type { MediaStore } from "./media.js";
import { experts as expertLibrary, expertContextText } from "./experts.js";
import {
  sessionExtensions,
  type ExtensionSnapshot,
} from "./session-extensions.js";
import type { Workspaces } from "./workspaces.js";
import { threadActivity } from "./thread-activity.js";
import { effortSupport } from "../shared/reasoning.js";
import { pluginUses } from "./plugin-uses.js";
import { gatewaySave, newGatewayId } from "../shared/gateways.js";
import { pluginLibrary } from "./plugins.js";
import {
  pluginConnections,
  pluginConnectorInstructions,
} from "./plugin-connections.js";
import { sessionRuntime } from "./session-runtime.js";
import { sessionInputs } from "./session-inputs.js";
import {
  approvalParameters,
  compatibleDefaultEffort,
} from "../shared/runtime-settings.js";
import { PublicError } from "./public-error.js";
import type { credentialVault } from "./credential-vault.js";
import { credentialBinding } from "./credential-vault.js";
import { providerEditable } from "./provider-policy.js";
import { mcpEditable } from "./mcp-policy.js";
import { appFail, AppFailure } from "./app-error.js";
import { appHostPolicy } from "../shared/mcp-app-host.js";
import { elicitations } from "./elicitation.js";
import { a2uiManager } from "./a2ui.js";
import { a2uiTool } from "./a2ui-tool.js";
import { EventType } from "@ag-ui/core";
import {
  configFail,
  ConfigurationFailure,
  publicConfigurationIssue,
} from "./configuration-error.js";
import { mcpManager, publicMcpStatus } from "./mcp-config.js";
import { providerManager, providerError, allowedEnv } from "./providers.js";
import {
  providerRuntimeInput,
  providerRuntimeValues,
} from "./provider-runtime.js";
import { managedCredential } from "./credential-vault.js";
import { providerReserved } from "./provider-policy.js";
import { providerUserConfig } from "./provider-policy.js";
import { configuration } from "./configuration.js";
import { skillUses } from "./skill-uses.js";
import { skillLibrary, skillSelections } from "./skills.js";
import { isMcpToolConsent } from "../shared/approvals.js";
import { z } from "zod";
import type { ArtifactStore } from "./artifacts.js";
import type { FileStore } from "./files.js";
import type { Codex } from "./codex.js";
import type { Store } from "./db.js";
import type { Json, Thread, Turn, Item } from "../shared/types.js";
import { AgentEvents } from "./ag-ui.js";
import { publicThread } from "./view.js";
import { appRegistry, sandboxDocument, appToolResult } from "./mcp-apps.js";
import { toolDisplay } from "./tool-display.js";
const id = z.string().min(1).max(200);
export function bridge(
  codex: Codex,
  db: Store,
  cwd: string,
  files: FileStore,
  artifacts: ArtifactStore,
  privateBusy: () => number = () => 0,
  vault?: ReturnType<typeof credentialVault>,
  workspaces?: Workspaces,
  media?: MediaStore,
) {
  const threadCwd = (id: string) => workspaces?.root(id) || cwd;
  codex.executionContext = (id) => ({
    cwd: threadCwd(id),
    developerInstructions: presentationInstructions(
      db.get(`thread-ui:${id}`) === "v2",
      appToolNames(id),
    ),
    revision: workspaces?.saved(id).revision || "",
    config: workspaces?.saved(id).snapshot.config || {},
  });
  const library = skillLibrary(codex, cwd);
  const configStore = configuration(codex, cwd, codex.providerRuntime, vault);
  const mcpStore = mcpManager(codex, configStore, vault);
  const providerStore = providerManager(codex, db, configStore, vault);
  const connections = pluginConnections(db, configStore.extensions, vault, () => !!codex.runtimeCapabilities?.mcpCustomCa);
  const toolNames = toolDisplay(db, (threadId, server) => {
    const snapshot =
      threadId && db.owns(threadId)
        ? workspaces?.saved(threadId).snapshot.config
        : undefined;
    return (
      snapshot?.connector_names?.[server] ||
      snapshot?.newbot_plugin_connections?.[server]?.server ||
      connections.owner(server)?.server ||
      configStore.extensions?.snapshot().values.connector_names?.[server]
    );
  });
  const apps = appRegistry(codex, {
    onCatalog: toolNames.remember,
    decorateItem: toolNames.item,
  });
  // The cached catalog is the only source for "this tool renders an app". Keep
  // it warm in the background so later turns can name those tools; never block
  // a send on discovery.
  const appToolNames = (threadId: string) =>
    apps.appTools(threadId).map((t) => `${t.server}/${t.tool}`);
  const appCatalog = (threadId: string) => {
    if (apps.catalogFresh(threadId, 10 * 60000)) return;
    void apps.refresh(threadId).catch(() => {});
  };
  if (configStore.extensions) codex.pluginConfiguration = connections.overlay;
  const plugins = pluginLibrary(
    codex,
    cwd,
    configStore,
    db,
    connections,
    library,
  );
  const extensions = workspaces
    ? sessionExtensions(codex, workspaces, configStore, library, plugins)
    : undefined;
  const extensionContext = codex.executionContext!;
  codex.executionContext = (threadId) => ({
    ...extensionContext(threadId),
    developerInstructions:
      presentationInstructions(
        db.get(`thread-ui:${threadId}`) === "v2",
        appToolNames(threadId),
      ) + pluginConnectorInstructions(extensionContext(threadId).config),
  });
  const runtimeSettings = sessionRuntime(
    codex,
    db,
    cwd,
    configStore,
    providerStore,
    catalog,
    threadCwd,
    (threadId, runtime) =>
      events.publish({
        type: EventType.CUSTOM,
        name: "newbot.session.runtime",
        value: { threadId, runtime },
        metadata: { threadId },
      }),
    async (threadId, before, providerRevision) => {
      await extensions?.refresh(threadId, before, providerRevision);
    },
  );
  const experts = expertLibrary(db, library, plugins, configStore);
  const inputs = sessionInputs(db, library, plugins, (threadId, nextInput) =>
    events.publish({
      type: EventType.CUSTOM,
      name: "newbot.session.inputs",
      value: { threadId, nextInput },
      metadata: { threadId },
    }),
  );
  const uses = skillUses(db);
  const pluginRefs = pluginUses(db);
  const decorate = (thread: Thread) =>
    experts.decorate(
      pluginRefs.decorate(
        Object.assign(
          ui.decorate(
            apps.decorate(
              artifacts.decorate(
                media
                  ? media.decorate(files.decorate(uses.decorate(thread)))
                  : files.decorate(uses.decorate(thread)),
              ),
            ),
          ),
          {
            uiCatalog: db.get(`thread-ui:${thread.id}`) || "v1",
            runtime: runtimeSettings.get(thread.id),
            nextInput: inputs.get(thread.id),
          },
        ),
      ),
    );
  const followups = followupService({
    db, read: (threadId) => readObserved(threadId),
    route: (threadId) => {
      if (maintenance || draining) throw new PublicError("服务维护中，请稍后生成追问");
      const runtime = runtimeSettings.get(threadId);
      return { provider: runtime.provider, model: runtime.model,
        revision: JSON.stringify([runtime.version, codex.providerRuntime?.revision, codex.privateVersion?.(threadId)]) };
    },
    generate: (...args) => providerStore.followups(...args),
  });
  const events = new AgentEvents((threadId, turnId, item) =>
    ui.decorateItem(
      threadId,
      turnId,
      toolNames.item(
        threadId,
        media ? media.decorateItem(threadId, turnId, item) : item,
      ),
    ),
  );
  const activity = threadActivity(db, (event) => events.publish(event));
  const ui = a2uiManager(
    codex,
    db,
    (threadId) => {
      activity.uiWaiting(threadId, ui.waiting(threadId));
      const thread = events.threads.get(threadId);
      if (thread) {
        ui.decorate(thread);
        events.publish(events.snapshot(threadId));
      }
    },
    (threadId, turnId) =>
      events.threads
        .get(threadId)
        ?.turns.some(
          (turn) => turn.id === turnId && turn.status === "inProgress",
        ) || false,
    media?.resolveImage,
  );
  const elicitation = elicitations(
    codex,
    db,
    (id, threadId) =>
      events.publish({
        type: EventType.CUSTOM,
        name: "newbot.elicitation.expired",
        value: { id, threadId },
        metadata: { threadId },
      }),
    toolNames.approval,
  );
  const starting = new Set<string>();
  let models: Json[] = [];
  let providers: string[] = [];
  let currentProvider = "";
  let currentModel = "";
  let currentEffort = "";
  let maintenance = false;
  let draining = false;
  let inflight = 0;
  let oauthUntil = 0;
  let oauthLoginId: string | undefined;
  let oauthPending = false, oauthGeneration = 0;
  const oauthEarlyCompletions = new Set<string>();
  const maxTurns = Math.max(
    1,
    Math.min(5, Number(process.env.MAX_ACTIVE_TURNS) || 2),
  );
  codex.on("event", (message) => {
    if (!["mcpServer/oauthLogin/completed", "mcpServer/oauth/login/completed"].includes(message.method) || !oauthUntil) return;
    const loginId = message.params.loginId;
    if (oauthPending) {
      if (typeof loginId === "string" && oauthEarlyCompletions.size < 16) oauthEarlyCompletions.add(loginId);
      return;
    }
    if (oauthLoginId ? loginId === oauthLoginId : !loginId) { oauthUntil = 0; oauthLoginId = undefined; }
  });
  let skills: Json[] = [];
  const grants = new Map<
    string,
    { recordToken: string; tool: string; args: Json; expires: number; automatic?: { version: number; privateRevision?: string } }
  >();
  async function appAutomaticPolicy(threadId: string) {
    const selected = runtimeSettings.get(threadId);
    if (selected.approval !== "full" || selected.applied?.approval !== "full") return undefined;
    if (!(await runtimeSettings.presets(selected.model)).some((preset) => preset.id === "full" && preset.allowed)) return undefined;
    const current = runtimeSettings.get(threadId);
    if (current.version !== selected.version || current.approval !== "full" || current.applied?.approval !== "full") return undefined;
    return { version: current.version || 0, privateRevision: codex.privateVersion?.(threadId) };
  }
  async function checkAppConfiguration(threadId: string, server: string) {
    if (!configStore.extensions) return;
    const current = (await configStore.read()).response.config as Json;
    if (current.mcp_servers?.[server]?.enabled === false)
      appFail("permission", "连接器已停用，请重新启用后操作", 403);
    const snapshot = workspaces?.saved(threadId).snapshot.config;
    const owner = snapshot?.newbot_plugin_connections?.[server] || connections.owner(server);
    if (owner && (snapshot?.plugins?.[owner.pluginId]?.enabled !== true || current.plugins?.[owner.pluginId]?.enabled === false || configStore.extensions.snapshot().values.plugins[owner.pluginId]?.installed === false))
      appFail("permission", "此会话未启用该插件，请在对话中引用后再操作", 403);
  }
  const appConfigurationRevision = (threadId: string) => JSON.stringify([
    configStore.extensions?.revision, connections.version(), codex.privateVersion?.(threadId),
  ]);
  apps.onRevoke((token) => {
    for (const [id, grant] of grants)
      if (grant.recordToken === token) grants.delete(id);
  });
  codex.on("status", () => {
    if (codex.state === "offline") {
      // Requests belonging to a stopped process cannot authorize a future connection.
      oauthUntil = 0;
      oauthLoginId = undefined;
      oauthPending = false;
      oauthGeneration++;
      oauthEarlyCompletions.clear();
      grants.clear();
      apps.clear();
    }
  });
  const own = (threadId: string) => {
    if (!db.owns(threadId)) throw new PublicError("会话不存在");
  };
  async function ensurePrivateBindings() {
    if (
      !vault ||
      !codex.credentialRefs.size ||
      codex.state !== "ready" ||
      maintenance
    )
      return;
    const actual = await configStore.read(),
      valid = vault.validRefs(actual.response.config);
    if ([...codex.credentialRefs].some((ref) => !valid.has(ref))) {
      await codex.stopAndWait();
      codex.offline("凭证绑定已变化，旧授权已停止，请核对配置后重新连接");
      configFail(
        "凭证绑定已变化，旧授权已停止，请核对配置后重新连接",
        409,
        "conflict",
        "unchanged",
        "reconnect",
      );
    }
  }
  type Discovery = { threadId: string; revision: string };
  const discovery = new Map<string, Discovery>();
  const discovering = new Map<string, Promise<string | undefined>>();
  async function discoveryThread(refresh = false, pluginId = ""): Promise<string | undefined> {
    if (!configStore.extensions) return undefined;
    const existing = discovering.get(pluginId);
    if (existing) return existing;
    const operation = (async () => {
      const before = await configStore.read();
      const config = configStore.extensions!.config(before.response);
      // Directory/status discovery is not a user plugin invocation. A plugin's
      // explicit diagnostic may initialize its connectors, but never its hooks.
      for (const plugin of Object.values(config.plugins || {}) as Json[]) plugin.enabled = false;
      if (codex.runtimeCapabilities?.pinnedPluginRoots) config.plugins._default = {enabled:false};
      for (const skill of config.skills?.config || []) skill.enabled = false;
      for (const [name, owner] of Object.entries(config.newbot_plugin_connections || {}) as [string,Json][])
        if (owner.pluginId !== pluginId && config.mcp_servers?.[name]) config.mcp_servers[name].enabled = false;
      const revision = JSON.stringify([config, connections.version(), codex.privateVersion?.()]);
      const previous = discovery.get(pluginId);
      if (!refresh && previous?.revision === revision && codex.loaded.has(previous.threadId)) return previous.threadId;
      if (previous) {
        await codex.call("thread/unsubscribe", {threadId:previous.threadId}).catch(() => {});
        codex.loaded.delete(previous.threadId);
        discovery.delete(pluginId);
      }
      const result = await codex.call("thread/start", {cwd,ephemeral:true,config});
      codex.loaded.add(result.thread.id);
      discovery.set(pluginId,{threadId:result.thread.id,revision});
      return result.thread.id;
    })();
    discovering.set(pluginId,operation);
    try { return await operation; }
    finally { if (discovering.get(pluginId) === operation) discovering.delete(pluginId); }
  }
  async function discoverMcp(pluginId = "") {
    return apps.refresh(await discoveryThread(false,pluginId), pluginId ? `diagnostic:${pluginId}` : "");
  }
  let discoveredMcp: any[] = [];
  let skillsWarnings = 0;
  async function settings(discover = true) {
    if (discover) await ensurePrivateBindings();
    if (discover && codex.state !== "ready")
      configFail(
        "Codex 尚未就绪，请稍候",
        503,
        "read_failed",
        "unconfirmed",
        "reconnect",
      );
    const results = await Promise.allSettled([
      discover
        ? codex.call("model/list", { limit: 100 })
        : Promise.resolve({ data: models }),
      configStore.read(),
      discover
        ? library.list()
        : Promise.resolve({ skills, warnings: skillsWarnings }),
      discover ? discoverMcp() : Promise.resolve(discoveredMcp),
    ]);
    const values: any[] = results.map((r) =>
      r.status === "fulfilled" ? r.value : null,
    );
    models = values[0]?.data?.filter((m: Json) => !m.hidden) || [];
    let cursor = values[0]?.nextCursor;
    for (let page = 1; cursor && page < 20; page++) {
      const next = await codex.call("model/list", { limit: 100, cursor });
      models.push(...next.data.filter((m) => !m.hidden));
      cursor = next.nextCursor;
    }
    if (configStore.runtime && values[1]?.publicView) {
      const saved = db.raw
        .prepare("SELECT DISTINCT provider FROM threads WHERE provider!=''")
        .all() as { provider: string }[];
      for (const { provider } of saved)
        if (missingProvider(provider))
          values[1].publicView.providers.push({
            id: provider,
            name: "会话网关 " + provider.slice(-8),
            missing: true,
            editable: true,
            requiresAccountAuth: false,
            endpointOrigin: null,
            wireApi: "responses",
            credentials: "none",
          });
    }
    const config = values[1]?.response.config || {};
    if (values[1]) currentProvider = config.model_provider || "openai";
    if (values[1])
      currentModel =
        (
          models.find((m) => m.model === config.model) ||
          models.find((m) => m.isDefault) ||
          models[0]
        )?.model || "";
    if (values[1])
      providers = [
        ...new Set<string>([
          config.model_provider || "openai",
          "openai",
          ...Object.keys(config.model_providers || {}),
          ...values[1].publicView.providers
            .filter((p: Json) => p.missing)
            .map((p: Json) => p.id),
        ]),
      ];
    if (values[1])
      currentEffort =
        config.model_reasoning_effort ||
        models.find((m) => m.model === currentModel)?.defaultReasoningEffort ||
        "";
    skills = values[2]?.skills || [];
    skillsWarnings = values[2]?.warnings || 0;
    discoveredMcp = values[3] || [];
    return {
      models,
      configuration: values[1]?.publicView || null,
      configurationIssue:
        results[1].status === "rejected"
          ? publicConfigurationIssue(results[1].reason)
          : null,
      providers: providers.map((p) => ({
        id: p,
        name: p,
        current: p === currentProvider,
      })),
      model: config.model || currentModel,
      effort: currentEffort,
      skills: skills.filter((s) => !s.pluginId),
      skillsWarnings: values[2]?.warnings || 0,
      mcp: (values[3] || []).map(pluginMcpStatus),
      errors: results.flatMap((r, i) =>
        r.status === "rejected"
          ? [
              {
                section: ["models", "config", "skills", "mcp"][i],
                message: "该配置项读取失败，请检查服务端配置",
              },
            ]
          : [],
      ),
      cwd,
      maxActiveTurns: maxTurns,
      maintenance,
    };
  }
  async function discoverSettings(section: string) {
    if (section === "skills") {
      const result = await library.list();
      skills = result.skills;
      skillsWarnings = result.warnings;
      return { skills: skills.filter((s) => !s.pluginId), skillsWarnings };
    }
    if (section === "mcp") {
      discoveredMcp = await discoverMcp();
      return { mcp: discoveredMcp.map(pluginMcpStatus) };
    }
    if (section === "models") {
      const result = await codex.call("model/list", { limit: 100 });
      models = result.data.filter((m) => !m.hidden);
      let cursor = result.nextCursor;
      while (cursor) {
        const page = await codex.call("model/list", { limit: 100, cursor });
        models.push(...page.data.filter((m) => !m.hidden));
        cursor = page.nextCursor;
      }
      return { models };
    }
    throw new PublicError("未知目录");
  }
  function pluginMcpStatus(raw: any) {
    const owner = connections.owner(raw.name);
    return {
      ...publicMcpStatus(raw),
      ...(owner
        ? {
            plugin: true,
            pluginId: owner.pluginId,
            pluginServer: owner.server,
            ownershipSource: owner.source,
          }
        : {}),
    };
  }
  async function read(threadId: string, cursor?: string) {
    own(threadId);
    if (
      !cursor &&
      codex.loaded.has(threadId) &&
      events.threads.has(threadId) &&
      events.threads.get(threadId)!.turns.length === 0
    )
      return decorate(events.threads.get(threadId)!);
    if (
      !cursor &&
      events.threads.get(threadId)?.turns.some((t) => t.status === "inProgress")
    )
      return decorate(events.threads.get(threadId)!);
    const summary = await codex.call("thread/read", { threadId });
    if (!runtimeSettings.get(threadId).model && summary.thread.model)
      runtimeSettings.adopt(threadId, {
        model: summary.thread.model,
        modelProvider: summary.thread.modelProvider,
        reasoningEffort: summary.thread.reasoningEffort,
      });
    const history = await codex.call("thread/turns/list", {
      threadId,
      limit: 30,
      sortDirection: "desc",
      itemsView: "full",
      ...(cursor ? { cursor } : {}),
    });
    for (const turn of history.data)
      for (const item of turn.items) apps.register(threadId, item);
    const thread = publicThread(
      summary.thread,
      [...history.data].reverse(),
      history.nextCursor,
    );
    restoreFailures(db, thread);
    decorate(thread);
    if (cursor) return thread;
    return events.seed(thread);
  }
  async function readObserved(threadId: string, cursor?: string) {
    const observed = activity.revision(threadId);
    const thread = await read(threadId, cursor);
    if (!cursor)
      activity.reconcile(thread, codex.active.has(thread.id), true, observed);
    return thread;
  }
  function requireIdle(ownPrivate = false, ownStart?: string) {
    for (const [key, grant] of grants)
      if (grant.expires < Date.now()) grants.delete(key);
    if (
      maintenance ||
      draining ||
      inflight > 1 ||
      [...starting].some((id) => id !== ownStart) ||
      codex.active.size ||
      codex.approvals.size ||
      codex.toolRequests.size ||
      privateBusy() > (ownPrivate ? 1 : 0) ||
      grants.size ||
      oauthUntil > Date.now()
    )
      configFail(
        "请等待任务、审批、应用调用、私密输入和 OAuth 完成后再操作配置",
        400,
        "busy",
        "unchanged",
        "wait",
      );
  }
  async function catalog() {
    const found: Json[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await codex.call("model/list", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      found.push(...result.data.filter((m) => !m.hidden));
      cursor = result.nextCursor || undefined;
      if (!cursor) break;
    }
    return found;
  }
  function missingProvider(provider: string) {
    return (
      !!configStore.runtime &&
      !providerReserved.has(provider) &&
      !configStore.runtime.snapshot().values.model_providers[provider] &&
      !!db.raw
        .prepare("SELECT 1 FROM threads WHERE provider=? LIMIT 1")
        .get(provider)
    );
  }
  async function reloadProviderConfiguration() {
    try {
      await codex.restart();
    } catch {
      if (codex.state !== "offline")
        codex.offline("Provider 配置需要重新连接后确认");
      configFail(
        "配置已写入，但 Codex 重启失败，请修复配置后重新连接",
        502,
        "reload_failed",
        "saved",
        "reconnect",
      );
    }
    apps.clear();
    if (codex.state !== "ready")
      configFail(
        "配置已写入，但 Codex 重启失败，请修复配置后重新连接",
        502,
        "reload_failed",
        "saved",
        "reconnect",
      );
    const actual = await settings();
    if (!actual.configuration) {
      codex.offline("配置读回失败，请重新连接后读取配置");
      configFail(
        "配置已写入，但刷新失败，请恢复连接后重新读取确认",
        502,
        "readback_failed",
        "saved",
        "reconnect",
      );
    }
    return actual;
  }
  async function providerOperation(method: string, params: Json) {
    if (configStore.runtime) {
      if (maintenance || draining)
        configFail("配置暂不可修改，请稍后重试", 409, "busy");
      if (method === "provider/models" || method === "provider/test")
        return providerStore.probe(params, catalog, method === "provider/test");
      const result =
        method === "provider/save"
          ? await providerStore.save(params)
          : await providerStore.remove(params);
      db.audit(method, "provider", configStore.runtime.storage + "-updated");
      events.publish({
        type: EventType.CUSTOM,
        name: "newbot.configuration.changed",
        value: {
          scope: "provider",
          targetId: params.id,
          configuration: result.configuration,
          storage: configStore.runtime.storage,
        },
      });
      return { state: result.state, configuration: result.configuration };
    }
    requireIdle();
    maintenance = true;
    let baseline: string | undefined;
    let reloadAttempted = false;
    try {
      if (method === "provider/models" || method === "provider/test")
        return await providerStore.probe(
          params,
          catalog,
          method === "provider/test",
        );
      baseline = (await configStore.read()).publicView.revision;
      const result =
        method === "provider/save"
          ? await providerStore.save(params)
          : await providerStore.remove(params);
      reloadAttempted = true;
      const actual = await reloadProviderConfiguration();
      db.audit(method, "provider", "saved-and-reloaded");
      return {
        state: result.state,
        configuration: actual.configuration,
        ...(result.state === "overridden"
          ? {
              configurationIssue: {
                code: "overridden",
                persistence: "saved",
                recovery: "read",
              },
            }
          : {}),
      };
    } catch (error) {
      if (baseline && !reloadAttempted) {
        // A lost reply can leave a successful native write behind. Reconcile the process from
        // authoritative config, without retrying the write or overwriting concurrent edits.
        let changed = false;
        try {
          changed = (await configStore.read()).publicView.revision !== baseline;
        } catch {
          codex.offline("Provider 配置状态未确认，请重新连接后读取配置");
        }
        if (changed) {
          reloadAttempted = true;
          await reloadProviderConfiguration();
        }
      }
      db.audit(method, "provider", "failed-or-unconfirmed");
      throw error;
    } finally {
      maintenance = false;
    }
  }
  async function ensureProviderAuthentication(
    provider: string,
    ownStart?: string,
  ) {
    if (!configStore.runtime || !vault || codex.privateConfiguration) return;
    const snapshot = await configStore.read();
    const ref = (snapshot.response.config.model_providers as any)?.[provider]
      ?.env_key;
    if (!managedCredential(ref) || codex.credentialRefs.has(ref)) return;
    if (!vault.validRefs(snapshot.response.config).has(ref))
      throw new PublicError("此网关的凭证尚未就绪，请重新设置私密凭证");
    requireIdle(false, ownStart);
    maintenance = true;
    try {
      await reloadProviderConfiguration();
    } finally {
      maintenance = false;
    }
    if (!codex.credentialRefs.has(ref))
      throw new PublicError("此网关的凭证尚未载入，请重新连接后再试");
  }
  async function reloadMcp(saved = false) {
    try {
      await codex.call("config/mcpServer/reload", undefined);
    } catch {
      apps.clear();
      codex.offline("MCP 配置重载未确认，请重新连接后读取配置");
      configFail(
        "MCP 配置可能已写入，但重载未确认，请关闭设置，检查服务端配置后重新连接 Codex",
        502,
        "reload_failed",
        saved ? "saved" : "unchanged",
        "reconnect",
      );
    }
    apps.clear();
  }
  async function mcpOperation(method: string, params: Json) {
    if (configStore.extensions && ["mcp/test", "mcp/reload"].includes(method)) {
      await mcpStore.check(params, method === "mcp/test");
      const threadId = await discoveryThread(true);
      if (method === "mcp/test") return mcpStore.test(params, threadId);
      await apps.refresh(threadId, "");
      return {
        state: "reloaded",
        configuration: (await configStore.read()).publicView,
      };
    }

    if (
      configStore.extensions &&
      ["mcp/save", "mcp/delete", "mcp/enabled"].includes(method)
    ) {
      const saved =
        method === "mcp/save"
          ? await mcpStore.save(params)
          : method === "mcp/delete"
            ? await mcpStore.remove(params)
            : await mcpStore.enabled(params);
      events.publish({
        type: EventType.CUSTOM,
        name: "newbot.configuration.changed",
        value: {
          scope: "mcp",
          targetId: params.id,
          configuration: saved.configuration,
        },
      });
      return { state: saved.state, configuration: saved.configuration };
    }
    requireIdle();
    maintenance = true;
    let baseline: string | undefined,
      reloadAttempted = false;
    try {
      if (method === "mcp/test" || method === "mcp/reload") {
        const checked = await mcpStore.check(params, method === "mcp/test");
        // Disabled connections are reported without starting any MCP process.
        if (
          method === "mcp/test" &&
          checked.before.publicView.mcp.find((s) => s.id === checked.data.id)
            ?.enabled === false
        )
          return await mcpStore.test(params);
        await reloadMcp();
        if (method === "mcp/test") return await mcpStore.test(params);
        const actual = await settings();
        if (!actual.configuration) {
          codex.offline("MCP 配置读回失败，请重新连接后读取配置");
          configFail(
            "MCP 已提交重载，但配置读回失败，请恢复连接后重新读取",
            502,
            "readback_failed",
            "unconfirmed",
            "reconnect",
          );
        }
        return { state: "reloaded", configuration: actual.configuration };
      }
      baseline = (await configStore.read()).publicView.revision;
      const saved =
        method === "mcp/save"
          ? await mcpStore.save(params)
          : method === "mcp/delete"
            ? await mcpStore.remove(params)
            : await mcpStore.enabled(params);
      reloadAttempted = true;
      await reloadMcp(true);
      const actual = await settings();
      if (!actual.configuration) {
        codex.offline("MCP 配置读回失败，请重新连接后读取配置");
        configFail(
          "MCP 配置已写入，但读回失败，请重新读取确认",
          502,
          "readback_failed",
          "saved",
          "reconnect",
        );
      }
      db.audit(method, "mcp", "saved-and-reloaded");
      return {
        state: saved.state,
        configuration: actual.configuration,
        ...(saved.state === "overridden"
          ? {
              configurationIssue: {
                code: "overridden",
                persistence: "saved",
                recovery: "read",
              },
            }
          : {}),
      };
    } catch (error) {
      db.audit(method, "mcp", "failed-or-unconfirmed");
      if (baseline && !reloadAttempted) {
        let changed = false;
        try {
          changed = (await configStore.read()).publicView.revision !== baseline;
        } catch {
          codex.offline("MCP 配置状态未确认，请重新连接后读取配置");
        }
        if (changed) await reloadMcp();
      }
      throw error;
    } finally {
      maintenance = false;
    }
  }
  async function recoverConfiguration(params: Json) {
    const data = z
      .object({
        action: z.literal("configuration/recover").optional(),
        mode: z.enum(["read", "reconnect"]),
      })
      .strict()
      .parse(params);
    requireIdle();
    maintenance = true;
    try {
      if (data.mode === "reconnect") {
        try {
          await codex.restart();
        } catch {
          codex.offline("配置恢复需要重新连接 Codex");
          configFail(
            "Codex 重新连接失败，请检查服务端配置后重试",
            502,
            "reload_failed",
            "unconfirmed",
            "reconnect",
          );
        }
        apps.clear();
      }
      if (codex.state !== "ready")
        configFail(
          "Codex 尚未就绪，请重新连接后读取配置",
          503,
          "read_failed",
          "unconfirmed",
          "reconnect",
        );
      const actual = await settings(!configStore.runtime);
      if (!actual.configuration) {
        codex.offline("配置仍不可读，请修复配置后重新连接");
        configFail(
          "配置仍不可读，请检查服务端配置后重新连接",
          503,
          "read_failed",
          "unconfirmed",
          "reconnect",
        );
      }
      db.audit("configuration/recover", "runtime", data.mode);
      return {
        state: data.mode === "read" ? "read" : "reconnected",
        settings: actual,
      };
    } finally {
      maintenance = false;
    }
  }
  async function switchProvider(provider: string, expectedRevision?: string) {
    if (configStore.runtime) {
      const before = await configStore.read();
      const gateway = (await runtimeSettings.catalog()).find(
        (g) => g.id === provider,
      );
      if (!gateway) throw new PublicError("未知网关，请刷新配置");
      await configStore.mutate(
        expectedRevision || before.publicView.revision,
        async () => ({
          edits: [
            {
              keyPath: "model_provider",
              value: provider,
              mergeStrategy: "replace",
            },
            {
              keyPath: "model",
              value: gateway.defaultModel || gateway.models[0]?.model || null,
              mergeStrategy: "replace",
            },
          ],
          effective: (after) => after.publicView.defaults.provider === provider,
        }),
      );
      await settings();
      return;
    }
    if (expectedRevision) {
      const snapshot = await configStore.read();
      if (snapshot.publicView.revision !== expectedRevision)
        configFail("配置已变化，请重新读取后再切换", 409, "conflict");
    }
    if (provider === currentProvider) return;
    if (!providers.includes(provider))
      throw new PublicError("未知 Provider，请刷新配置");
    for (const [key, grant] of grants)
      if (grant.expires < Date.now()) grants.delete(key);
    if (
      maintenance ||
      draining ||
      inflight > 1 ||
      starting.size ||
      codex.active.size ||
      codex.approvals.size ||
      codex.toolRequests.size ||
      privateBusy() ||
      grants.size ||
      oauthUntil > Date.now()
    )
      configFail(
        "请等待所有任务、审批、应用调用、私密输入和 OAuth 完成后再切换 Provider",
        400,
        "busy",
        "unchanged",
        "wait",
      );
    const before = await configStore.read();
    requireIdle();
    maintenance = true;
    const previous = currentProvider;
    let written: Awaited<ReturnType<typeof configStore.read>> | undefined;
    try {
      if (before.target) {
        const result = await configStore.mutate(
          expectedRevision || before.publicView.revision,
          async () => ({
            edits: [
              {
                keyPath: "model_provider",
                value: provider,
                mergeStrategy: "replace",
              },
            ],
            effective: (after) =>
              after.publicView.defaults.provider === provider,
          }),
        );
        written = result.after;
        if (result.state !== "applied")
          configFail(
            "Provider 选择受其他配置覆盖，请重新读取后检查",
            409,
            "overridden",
            "saved",
          );
      } else
        await codex.call("config/batchWrite", {
          edits: [
            {
              keyPath: "model_provider",
              value: provider,
              mergeStrategy: "replace",
            },
          ],
        });
      db.audit("provider/switch", provider, "requested");
      await codex.restart();
      apps.clear();
      await settings();
      if (currentProvider !== provider || !models.length)
        throw new PublicError("Provider 未返回可用模型，请检查配置");
      if (written) {
        const snapshot = await configStore.read();
        if (snapshot.publicView.revision !== written.publicView.revision)
          configFail(
            "切换期间配置发生变化，请重新读取确认当前 Provider 与模型",
            409,
            "conflict",
            "saved",
          );
        const configured = snapshot.response.config.model;
        const chosen =
          models.find((m) => m.model === configured) ||
          models.find((m) => m.isDefault) ||
          models[0];
        const effort = snapshot.response.config.model_reasoning_effort;
        const changes: import("../generated/codex/v2/ConfigEdit.js").ConfigEdit[] =
          [];
        if (configured && chosen.model !== configured)
          changes.push({
            keyPath: "model",
            value: chosen.model,
            mergeStrategy: "replace",
          });
        if (
          effort &&
          !chosen.supportedReasoningEfforts.some(
            (e: Json) => e.reasoningEffort === effort,
          )
        )
          changes.push({
            keyPath: "model_reasoning_effort",
            value: chosen.defaultReasoningEffort,
            mergeStrategy: "replace",
          });
        if (changes.length) {
          const normalized = await configStore.mutate(
            snapshot.publicView.revision,
            async () => ({
              edits: changes,
              effective: (after) =>
                changes.every(
                  (edit) => after.response.config[edit.keyPath] === edit.value,
                ),
            }),
          );
          written = normalized.after;
          if (normalized.state !== "applied")
            configFail(
              "Provider 已选择，但默认模型受其他配置覆盖，请重新读取",
              409,
              "overridden",
              "saved",
            );
          await settings();
        }
      }
      db.audit("provider/switch", provider, "ready");
    } catch (e) {
      let reverted = false;
      // Native config writes are authoritative. Roll back through the native API when it is reachable.
      if (codex.state === "ready" && (!before.target || written)) {
        try {
          if (before.target) {
            const old = providerUserConfig(before.response);
            const rollback = await configStore.mutate(
              written!.publicView.revision,
              async () => ({
                edits: [
                  "model_provider",
                  "model",
                  "model_reasoning_effort",
                ].map((keyPath) => ({
                  keyPath,
                  value: (old[keyPath] ?? null) as string | null,
                  mergeStrategy: "replace" as const,
                })),
                effective: (after) =>
                  after.publicView.defaults.provider === previous,
              }),
            );
            if (rollback.state !== "applied")
              configFail(
                "原配置受其他来源覆盖，请重新读取确认",
                409,
                "overridden",
                "saved",
              );
          } else
            await codex.call("config/batchWrite", {
              edits: [
                {
                  keyPath: "model_provider",
                  value: previous,
                  mergeStrategy: "replace",
                },
              ],
            });
          await codex.restart();
          const restored = await settings();
          if (!restored.configuration || currentProvider !== previous)
            configFail(
              "原配置未确认恢复，请重新读取",
              409,
              "write_unconfirmed",
              "unconfirmed",
            );
          reverted = true;
        } catch {
          // A concurrent edit must never be overwritten by rollback. Reload the process from authoritative state.
          await reloadProviderConfiguration().catch(() => {});
        }
      }
      db.audit("provider/switch", provider, "failed");
      if (reverted)
        configFail(
          "Provider 未返回可用模型或切换未完成，已恢复原配置，请重新读取确认",
          502,
          "switch_reverted",
        );
      if (codex.state !== "ready")
        configFail(
          "Provider 切换状态未确认，请修复配置后重新连接",
          502,
          "reload_failed",
          written ? "saved" : "unconfirmed",
          "reconnect",
        );
      if (e instanceof ConfigurationFailure) throw e;
      configFail(
        "Provider 切换状态未确认，请重新读取当前配置",
        502,
        "write_unconfirmed",
        "unconfirmed",
      );
    } finally {
      maintenance = false;
    }
  }
  return {
    isMissingProvider: missingProvider,
    async publishProviderConfiguration(
      input: unknown,
      expectedRevision?: string,
    ) {
      if (!configStore.runtime) throw new PublicError("当前实例未使用内存配置");
      if (maintenance || draining)
        configFail("配置暂不可修改，请稍后重试", 409, "busy");
      const data = providerRuntimeInput.parse(input);
      const before = await configStore.read();
      const values = providerRuntimeValues(data);
      const prior = (before.response.config.model_providers || {}) as Json;
      for (const id of Object.keys(prior)) {
        if (
          !values.model_providers[id] &&
          db.raw
            .prepare(
              "SELECT 1 FROM session_runtime_pending WHERE json_extract(candidate,'$.provider')=? LIMIT 1",
            )
            .get(id)
        )
          throw new PublicError("待应用的会话设置仍引用此网关，请先撤销或修改");
      }
      for (const p of data.providers) {
        if (
          providerReserved.has(p.id) ||
          ["constructor", "prototype", "__proto__"].includes(p.id)
        )
          throw new PublicError("此网关标识保留给原生运行时");
        if (
          p.envKey &&
          (managedCredential(p.envKey) || !allowedEnv(before, p.envKey))
        )
          throw new PublicError("凭证引用未授权，请通过私密入口管理");
      }
      for (const [id, def] of Object.entries(prior) as [string, Json][]) {
        if (!managedCredential(def.env_key)) continue;
        const next = values.model_providers[id];
        if (
          !next ||
          (next.env_key && next.env_key !== def.env_key) ||
          credentialBinding("provider", id, { model_providers: { [id]: next } })
            ?.binding !==
            credentialBinding("provider", id, before.response.config)?.binding
        )
          throw new PublicError("请先通过私密入口清除托管凭证，再更换接收方");
        next.env_key = def.env_key;
      }
      if (
        values.model_provider !== "openai" &&
        !values.model_providers[values.model_provider]
      )
        throw new PublicError("默认网关不在本次下发目录中");
      vault?.restoreProviderReferences(values);
      const result = await configStore.mutate(
        expectedRevision || before.publicView.revision,
        async () => ({
          edits: [
            ...[
              "model_providers",
              "model_provider",
              "model",
              "model_reasoning_effort",
            ].map((keyPath) => ({
              keyPath,
              value: (values as Json)[keyPath],
              mergeStrategy: "replace" as const,
            })),
            ...Object.keys((before.response.config.profiles || {}) as Json)
              .filter((k) => k.startsWith("newbot_gateway_"))
              .map((k) => ({
                keyPath: `profiles.${k}`,
                value: null,
                mergeStrategy: "replace" as const,
              })),
            ...Object.entries(values.profiles).map(([k, value]) => ({
              keyPath: `profiles.${k}`,
              value,
              mergeStrategy: "replace" as const,
            })),
          ],
          effective: (after) =>
            after.publicView.defaults.provider === values.model_provider,
        }),
      );
      db.audit(
        "runtime/config",
        "providers",
        configStore.runtime.storage + "-updated",
      );
      configStore.runtime.sourceStatus = "loaded";
      events.publish({
        type: EventType.CUSTOM,
        name: "newbot.configuration.changed",
        value: { storage: configStore.runtime.storage },
      });
      return result.configuration;
    },
    async providerConfiguration() {
      return (await configStore.read()).publicView;
    },
    ui,
    async publishExtensionAssets<T>(fn: (core: ReturnType<typeof configuration>) => Promise<T>) {
      if (!codex.runtimeCapabilities?.pinnedPluginRoots || !configStore.extensions)
        throw new PublicError("运行时尚不支持资源版本隔离");
      const result = await fn(configStore);
      events.publish({ type: EventType.CUSTOM, name: "newbot.configuration.changed", value: { scope: "extensions" } });
      return result;
    },
    async mutateExtensionAssets<T>(
      fn: (core: ReturnType<typeof configuration>) => Promise<T>,
    ) {
      requireIdle();
      maintenance = true;
      try {
        return await fn(configStore);
      } finally {
        apps.clear();
        maintenance = false;
      }
    },
    async inspectPrivateConfiguration<T>(
      fn: (core: ReturnType<typeof configuration>) => Promise<T>,
    ) {
      if (!codex.privateConfiguration) requireIdle(true);
      return fn(configStore);
    },
    async privateConfiguration<T>(
      own: boolean,
      fn: (core: ReturnType<typeof configuration>) => Promise<T>,
    ) {
      if (codex.privateConfiguration) return fn(configStore);
      requireIdle(own);
      maintenance = true;
      try {
        return await fn(configStore);
      } finally {
        maintenance = false;
      }
    },
    async reloadPrivateRuntime() {
      if (codex.privateConfiguration) return settings(false);
      return reloadProviderConfiguration();
    },
    async preparePrivateProbe(revision: string, providerId: string) {
      if (maintenance || draining || codex.state !== "ready")
        throw new PublicError("服务暂不可用，请稍后重新发起");
      return providerStore.preparePrivateProbe(revision, providerId);
    },
    apps,
    elicitation,
    skills: library,
    skillUses: uses,
    pluginUses: pluginRefs,
    get busy() {
      return maintenance || draining;
    },
    events,
    activity,
    settings,
    configuration: configStore,
    discoverSettings,
    runtimeSettings,
    inputs,
    extensions,
    experts,
    plugins,
    pluginConnections: connections,
    read: readObserved,
    followups,
    async handle(method: string, p: Json, context?: { sessionId: string }) {
      if (method === "app/close") {
        const data = z
          .object({
            token: id.optional(),
            requestId: z.string().uuid().optional(),
          })
          .strict()
          .refine((d) => !!d.token || !!d.requestId)
          .parse(p);
        if (data.token) apps.close(data.token, context?.sessionId);
        if (data.requestId) apps.cancel(data.requestId, context?.sessionId);
        return { closed: true };
      }
      if (method === "app/call/cancel") {
        const data = z.object({ grant: id }).strict().parse(p);
        const grant = grants.get(data.grant);
        if (grant) {
          const r = apps.live(grant.recordToken);
          if (r && r.owner !== context?.sessionId)
            appFail("permission", "此授权不属于当前浏览器会话", 403);
          grants.delete(data.grant);
        }
        return { cancelled: true };
      }
      if (method === "app/status") {
        const data = z.object({ token: id }).strict().parse(p);
        return apps.status(data.token, context?.sessionId);
      }
      if (maintenance && method.startsWith("app/"))
        appFail("busy", "配置正在更新，请稍后重新打开应用");
      if (maintenance)
        configFail(
          "配置正在更新，请稍后重新读取并重试",
          409,
          "busy",
          "unchanged",
          "wait",
        );
      if (
        draining &&
        !["bridge/status", "bridge/maintenance", "approval/list"].includes(
          method,
        )
      )
        throw new PublicError("服务正在维护，请稍后重试");
      inflight++;
      try {
        if (
          method.startsWith("app/") ||
          method.startsWith("mcp/") ||
          method.startsWith("provider/") ||
          method.startsWith("plugin/") ||
          method.startsWith("gateway/") ||
          method === "session/update" ||
          [
            "turn/start",
            "thread/start",
            "thread/resume",
            "mcp/test",
            "mcp/reload",
            "provider/test",
            "provider/models",
            "app/call",
            "app/call/confirm",
          ].includes(method)
        )
          await ensurePrivateBindings();
        switch (method) {
          case "bridge/maintenance": {
            const enabled = z.boolean().parse(p.enabled);
            for (const [key, grant] of grants)
              if (grant.expires < Date.now()) grants.delete(key);
            if (
              enabled &&
              (codex.active.size ||
                followups.pending() ||
                starting.size ||
                codex.approvals.size ||
                codex.toolRequests.size ||
                privateBusy() ||
                inflight > 1 ||
                grants.size ||
                oauthUntil > Date.now())
            )
              throw new PublicError("仍有任务或授权进行中，不能进入维护");
            draining = enabled;
            db.audit(
              "bridge/maintenance",
              "runtime",
              enabled ? "enabled" : "disabled",
            );
            return { maintenance: draining };
          }
          case "expert/list":
            return experts.list();
          case "expert/read":
            return experts.read(id.parse(p.id));
          case "expert/save": {
            const { action, ...data } = p;
            const result = await experts.save(data);
            events.publish({
              type: EventType.CUSTOM,
              name: "newbot.configuration.changed",
              value: { scope: "experts" },
            });
            return result;
          }
          case "expert/delete": {
            const { action, ...data } = p;
            const result = experts.remove(data);
            events.publish({
              type: EventType.CUSTOM,
              name: "newbot.configuration.changed",
              value: { scope: "experts" },
            });
            return result;
          }
          case "session/extensions": {
            const threadId = id.parse(p.threadId);
            own(threadId);
            const { action, ...data } = p;
            const result = await experts.update(data);
            events.publish({
              type: EventType.CUSTOM,
              name: "newbot.session.extensions",
              value: { threadId, extensions: result },
              metadata: { threadId },
            });
            return result;
          }
          case "session/inputs":
            return inputs.update(p);
          case "marketplace/list":
            if (!plugins.marketplaces) throw new PublicError("商店管理不可用");
            return plugins.marketplaces.list();
          case "marketplace/add":
          case "marketplace/upgrade":
          case "marketplace/remove":
            if (!plugins.marketplaces) throw new PublicError("商店管理不可用");
            return plugins.marketplaces.mutate(method, p);
          case "plugin/list":
            return plugins.list(p.includeTools === true);
          case "plugin/read":
            return plugins.read(id.parse(p.id));
          case "plugin/skill/read":
          case "plugin/skill/enabled": {
            const result = await plugins.skill(method, p);
            if (method === "plugin/skill/enabled")
              events.publish({
                type: EventType.CUSTOM,
                name: "newbot.configuration.changed",
                value: { scope: "extensions" },
              });
            return result;
          }
          case "plugin/connection/test": {
            const detail = await plugins.read(id.parse(p.pluginId));
            const connection = detail.connections.find(
              (c) => c.id === p.connectionId,
            );
            if (
              !detail.enabled ||
              !connection?.enabled ||
              !connection.configured ||
              connection.reason
            )
              throw new PublicError("请先启用插件并完成连接器配置");
            const statuses = await discoverMcp(detail.id);
            const status = statuses.find((s) => s.name === connection.id);
            if (!status)
              throw new PublicError("连接器尚未就绪，请检查配置后重试");
            const result = pluginMcpStatus(status);
            if (
              result.authStatus !== "notLoggedIn" &&
              result.runtimeStatus !== "authenticationRequired" &&
              (result.runtimeStatus === "failed" || result.toolsError)
            )
              throw new PublicError("连接未成功，请核对插件配置后重试");
            return result;
          }
          case "plugin/install":
          case "plugin/update":
          case "plugin/uninstall":
          case "plugin/enabled": {
            if (
              method === "plugin/uninstall" &&
              !codex.runtimeCapabilities?.pinnedPluginRoots &&
              inputs.references("plugins", id.parse(p.id))
            )
              throw new PublicError("下一条消息仍引用此插件，请先移除引用");
            if ((method === "plugin/enabled" || codex.runtimeCapabilities?.pinnedPluginRoots) && configStore.extensions) {
              const result = await plugins.mutate(method, p);
              events.publish({
                type: EventType.CUSTOM,
                name: "newbot.configuration.changed",
                value: { scope: "extensions" },
              });
              return result;
            }
            requireIdle();
            maintenance = true;
            try {
              const result = await plugins.mutate(method, p);
              apps.clear();
              events.publish({
                type: EventType.CUSTOM,
                name: "newbot.configuration.changed",
                value: { scope: "extensions" },
              });
              return result;
            } finally {
              maintenance = false;
            }
          }
          case "runtime/presets":
            return runtimeSettings.presets(
              p.model === undefined ? undefined : id.parse(p.model),
            );
          case "gateway/catalog":
            return runtimeSettings.catalog(
              p.refresh === true,
              typeof p.id === "string" ? p.id : undefined,
            );
          case "gateway/defaults": {
            if (!configStore.runtime) requireIdle();
            const result = await runtimeSettings.defaults(p);
            if (configStore.runtime)
              events.publish({
                type: EventType.CUSTOM,
                name: "newbot.configuration.changed",
                value: {
                  scope: "defaults",
                  configuration: result.configuration,
                  storage: configStore.runtime.storage,
                },
              });
            return result;
          }
          case "session/update": {
            const threadId = id.parse(p.threadId);
            own(threadId);
            const defer = !!(
              starting.has(threadId) ||
              codex.active.has(threadId) ||
              privateBusy() ||
              [
                ...codex.approvals.values(),
                ...codex.toolRequests.values(),
              ].some((a) => (a.params as Json).threadId === threadId)
            );
            if (!defer) starting.add(threadId);
            try {
              return await runtimeSettings.update(p, defer);
            } finally {
              if (!defer) starting.delete(threadId);
            }
          }
          case "configuration/recover":
            return await recoverConfiguration(p);
          case "mcp/save":
          case "mcp/delete":
          case "mcp/enabled":
          case "mcp/test":
            return await mcpOperation(method, p);
          case "provider/save":
          case "provider/delete":
          case "provider/models":
          case "provider/test":
            return providerOperation(method, p);
          case "gateway/save": {
            const data = gatewaySave.parse(p);
            const gatewayId = data.targetId || newGatewayId(data.requestId);
            const restoring = !!data.targetId && missingProvider(data.targetId);
            const result = await providerOperation("provider/save", {
              id: gatewayId,
              create: !data.targetId || restoring,
              rebindCredentials: data.rebindCredentials,
              expectedRevision: data.expectedRevision,
              patch: {
                name: data.name,
                ...(data.caCertificate !== undefined ? { caCertificate: data.caCertificate } : {}),
                ...(data.customModels !== undefined
                  ? { customModels: data.customModels }
                  : {}),
                ...(data.baseUrl ? { baseUrl: data.baseUrl } : {}),
              },
            });
            return { ...result, id: gatewayId };
          }
          case "provider/switch":
            await switchProvider(
              id.parse(p.provider),
              p.expectedRevision === undefined
                ? undefined
                : z
                    .string()
                    .regex(/^cfg1\.[a-f0-9]{64}$/)
                    .parse(p.expectedRevision),
            );
            return settings();
          case "bridge/status":
            return { state: codex.state, reason: codex.reason };
          case "bridge/restart":
            if (codex.state !== "offline")
              throw new PublicError("Codex 正在运行");
            await codex.restart();
            return { state: codex.state };
          case "skills/read":
            return library.read(
              z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .parse(p.id),
            );
          case "settings/read":
            return settings();
          case "thread/list":
            return db.list();
          case "thread/start": {
            if (!currentProvider || !models.length) await settings();
            const data = z
              .object({
                model: z.string().optional(),
                provider: z.string().optional(),
              })
              .parse(p);
            if (
              data.provider &&
              !(configStore.runtime
                ? data.provider === "openai" ||
                  !!configStore.runtime.snapshot().values.model_providers[
                    data.provider
                  ]
                : providers.includes(data.provider))
            )
              throw new PublicError("未知 Provider，请刷新配置");
            const selectedProvider =
              data.provider ||
              (configStore.runtime
                ? configStore.runtime.snapshot().values.model_provider
                : currentProvider);
            const gateway = (await runtimeSettings.catalog()).find(
              (g) => g.id === selectedProvider,
            );
            const discovered: Json[] = gateway?.models || [];
            const requestedModel =
              data.model ||
              gateway?.defaultModel ||
              (selectedProvider === currentProvider ? currentModel : "") ||
              discovered[0]?.model;
            const selectedApproval = z
              .enum(["ask", "review", "full"])
              .default("ask")
              .parse(p.approval);
            if (
              !(await runtimeSettings.presets(requestedModel)).some(
                (v) => v.id === selectedApproval && v.allowed,
              )
            )
              throw new PublicError("当前运行策略不允许此权限");
            if (
              requestedModel &&
              !discovered.some((m: Json) => m.model === requestedModel)
            )
              throw new PublicError("模型不在聊天可用列表中，请选择对话模型");
            const selected = discovered.find(
              (m: Json) => m.model === requestedModel,
            );
            const requestedEffort =
              p.effort ||
              compatibleDefaultEffort(
                selected,
                selectedProvider === currentProvider &&
                  selected?.model === currentModel
                  ? currentEffort
                  : undefined,
              );
            if (
              requestedEffort &&
              effortSupport(selected, requestedEffort) === "unsupported"
            )
              throw new PublicError("模型不支持该推理强度，请重新选择");
            const workspace = workspaces?.allocate();
            const runCwd = workspace?.root || cwd;
            const extensionSnapshot =
              p.extensionSnapshot || (await extensions?.capture(p.plugins || []));
            const preparedExtensions = extensionSnapshot
              ? await extensions!.prepare(runCwd, extensionSnapshot)
              : undefined;
            let r;
            try {
              r = await codex.call("thread/start", {
                ...(codex.privateConfiguration
                  ? { privateRunId: p.privateRunId }
                  : {}),
                ...(configStore.runtime
                  ? { providerConfigRevision: p.providerConfigRevision }
                  : {}),
                dynamicTools: [a2uiTool],
                developerInstructions:
                  presentationInstructions(true) +
                  pluginConnectorInstructions(
                    preparedExtensions?.snapshot.config,
                  ),
                cwd: runCwd,
                runtimeWorkspaceRoots: [runCwd],
                model: selected?.model,
                config: {
                  ...preparedExtensions?.snapshot.config,
                  ...(requestedEffort
                    ? { model_reasoning_effort: requestedEffort }
                    : {}),
                },
                modelProvider: data.provider || undefined,
                approvalPolicy: approvalParameters(selectedApproval, runCwd)
                  .approvalPolicy,
                approvalsReviewer: approvalParameters(selectedApproval, runCwd)
                  .approvalsReviewer,
                sandbox: approvalParameters(selectedApproval, runCwd).sandbox,
              });
            } catch (error) {
              await preparedExtensions?.rollback();
              throw error;
            }
            db.addThread(r.thread.id, r.thread.modelProvider);
            db.set(`thread-ui:${r.thread.id}`, "v2");
            appCatalog(r.thread.id);
            if (workspace) workspaces!.bind(r.thread.id, workspace);
            experts.attach(r.thread.id, p.expertId);
            if (preparedExtensions && workspaces) {
              workspaces.confirm(
                r.thread.id,
                preparedExtensions.snapshot.revision,
                preparedExtensions.snapshot,
              );
              await preparedExtensions.commit();
            }
            codex.threadExecutionRevisions.set(
              r.thread.id,
              preparedExtensions?.snapshot.revision || "",
            );
            db.raw
              .prepare(
                "INSERT OR REPLACE INTO session_runtime VALUES(?,0,?,?,?,?)",
              )
              .run(
                r.thread.id,
                r.thread.modelProvider,
                selected?.model || "",
                requestedEffort || "",
                selectedApproval,
              );
            codex.loaded.add(r.thread.id);
            const view = publicThread(r.thread, [], null);
            events.seed(view);
            return view;
          }
          case "thread/read":
            return readObserved(id.parse(p.threadId), p.cursor);
          case "thread/resume": {
            const threadId = id.parse(p.threadId);
            own(threadId);
            const session = runtimeSettings.applied(threadId);
            const resumed = await codex.resume(
              threadId,
              session.provider,
              session.approval,
              session.model || undefined,
            );
            if (!session.model) runtimeSettings.adopt(threadId, resumed);
            return read(threadId);
          }
          case "thread/name/set": {
            const data = z
              .object({ threadId: id, name: z.string().trim().min(1).max(120) })
              .parse(p);
            own(data.threadId);
            await codex.call(method, data);
            db.rename(data.threadId, data.name);
            return {};
          }
          case "thread/archive": {
            const threadId = id.parse(p.threadId);
            own(threadId);
            if (codex.active.has(threadId) || starting.has(threadId))
              throw new PublicError("请先停止正在执行的任务");
            await codex.call(method, { threadId });
            db.archive(threadId);
            return {};
          }
          case "turn/start": {
            if (!currentProvider || !models.length) await settings();
            const data = z
              .object({
                threadId: id,
                text: z.string().trim().max(200000),
                attachments: z.array(z.string()).max(8).default([]),
                skills: skillSelections.default([]),
                plugins: z.array(z.string().min(1).max(200)).max(8).default([]),
                model: z.string().optional(),
                effort: z.string().optional(),
                clientUserMessageId: z.string().uuid().optional(),
              })
              .refine((v) => v.text.length > 0 || v.attachments.length > 0, "请输入消息或添加附件")
              .parse(p);
            own(data.threadId);
            if (codex.active.has(data.threadId) || starting.has(data.threadId))
              throw new PublicError("当前任务正在执行");
            if (new Set([...codex.active, ...starting]).size >= maxTurns)
              throw new PublicError("并行任务已满，请等待任务结束");
            appCatalog(data.threadId);
            starting.add(data.threadId);
            try {
              if (
                p.extensionRevision !== undefined &&
                p.extensionRevision !== experts.session(data.threadId).revision
              )
                throw new PublicError("会话专家已变化，请重新读取后发送");
              if (
                p.inputRevision !== undefined &&
                p.inputRevision !== inputs.get(data.threadId).revision
              )
                throw new PublicError(
                  "下一条消息的扩展已变化，请重新读取后发送",
                );
              const session = runtimeSettings.get(data.threadId);
              data.model ??= session.model || undefined;
              data.effort ??= session.effort || undefined;
              await ensureProviderAuthentication(
                session.provider,
                data.threadId,
              );
              if (
                p.runtimeRevision !== undefined &&
                p.runtimeRevision !== session.revision
              )
                throw new PublicError("会话配置已变化，请重新读取后发送");
              if (p.provider && p.provider !== session.provider)
                throw new PublicError("会话网关已变化，请重新读取后发送");
              if (
                !(
                  await runtimeSettings.presets(data.model || session.model)
                ).some((p) => p.id === session.approval && p.allowed)
              )
                throw new PublicError(
                  "当前执行策略不再允许此会话权限，请重新选择审批级别",
                );
              const discovered: Json[] =
                (await runtimeSettings.catalog()).find(
                  (g) => g.id === session.provider,
                )?.models || [];
              const model = discovered.find(
                (m: Json) => m.model === data.model,
              );
              data.effort ||= model?.defaultReasoningEffort || undefined;
              if (data.model && !model)
                throw new PublicError("请从已发现的模型中选择");
              if (
                data.effort &&
                !(
                  data.model === session.model && data.effort === session.effort
                ) &&
                effortSupport(model, data.effort) === "unsupported"
              )
                throw new PublicError("模型不支持该推理强度");
              const extensionSnapshot: ExtensionSnapshot | undefined =
                p.extensionSnapshot || (await extensions?.capture(p.plugins || []));
              await connections.requireConfigured(
                data.plugins,
                extensionSnapshot?.config,
              );
              await runtimeSettings.apply(
                data.threadId,
                session.revision,
                p.providerConfigRevision,
                async (before) => {
                  await extensions?.sync(
                    data.threadId,
                    extensionSnapshot,
                    before,
                    p.providerConfigRevision,
                  );
                },
              );
              const resumed = await codex.resume(
                data.threadId,
                session.provider,
                session.approval,
                session.model || undefined,
                p.providerConfigRevision,
              );
              if (!session.model) runtimeSettings.adopt(data.threadId, resumed);
              const pluginConnectors = Object.entries(
                extensionSnapshot?.config.newbot_plugin_connections || {},
              ).filter(
                ([name, owner]: [string, any]) =>
                  data.plugins.includes(owner.pluginId) &&
                  extensionSnapshot?.config.mcp_servers?.[name]?.enabled !==
                    false,
              );
              if (extensionSnapshot || p.connectorIds?.length) {
                const available = await apps.refresh(data.threadId);
                for (const name of new Set([
                  ...(p.connectorIds || []),
                  ...pluginConnectors.map(([name]) => name),
                ])) {
                  const server = available.find((s) => s.name === name);
                  if (
                    !server ||
                    [
                      "disabled",
                      "failed",
                      "cancelled",
                      "authenticationRequired",
                      "notStarted",
                      "starting",
                    ].includes(server.runtimeStatus) ||
                    server.toolsError
                  ) {
                    const owner = pluginConnectors.find(
                      ([id]) => id === name,
                    )?.[1] as any;
                    throw new PublicError(
                      owner
                        ? `插件的连接器“${owner.server}”未就绪，请在插件设置中检查连接后重试`
                        : `专家的连接器“${name}”未就绪，请检查连接后重试`,
                    );
                  }
                }
              }
              await read(data.threadId);
              db.touch(data.threadId);
              const row = db.raw
                .prepare("SELECT title FROM threads WHERE id=?")
                .get(data.threadId) as Json;
              if (row.title === "新对话") {
                const title = data.text.slice(0, 36) || "附件消息";
                db.rename(data.threadId, title);
                void codex
                  .call("thread/name/set", {
                    threadId: data.threadId,
                    name: title,
                  })
                  .catch(() => {});
              }
              const prepared = await library.prepare(data.skills);
              const selectedPlugins = await plugins.prepare(data.plugins);
              const input = [
                ...(data.text ? [{ type: "text" as const, text: data.text, text_elements: [] }] : []),
                ...(p.expertSnapshot && (p.connectorIds?.length || p.expertSnapshot.instructions)
                  ? [
                      {
                        type: "text" as const,
                        text: expertContextText(
                          p.expertSnapshot,
                          p.connectorIds || [],
                        ),
                        text_elements: [],
                      },
                    ]
                  : []),
                ...(await files.inputs(data.attachments, threadCwd(data.threadId))),
                ...(extensions?.inputPaths(data.threadId, prepared.inputs) ||
                  prepared.inputs),
                ...selectedPlugins.inputs,
              ];
              if (typeof p.onDispatch === "function")
                p.onDispatch(prepared.references, selectedPlugins.references);
              const result = await codex.call("turn/start", {
                threadId: data.threadId,
                clientUserMessageId: data.clientUserMessageId,
                input,
                ...(extensionSnapshot
                  ? { disabledPluginIds: extensionSnapshot.disabledPluginIds }
                  : {}),
                model: data.model,
                effort:
                  data.effort || model?.defaultReasoningEffort || undefined,
                approvalPolicy: approvalParameters(
                  session.approval,
                  threadCwd(data.threadId),
                ).approvalPolicy,
                approvalsReviewer: approvalParameters(
                  session.approval,
                  threadCwd(data.threadId),
                ).approvalsReviewer,
                sandboxPolicy: approvalParameters(
                  session.approval,
                  threadCwd(data.threadId),
                ).sandboxPolicy,
              });
              const observedStatus = events.threads
                .get(data.threadId)
                ?.turns.find((t) => t.id === result.turn.id)?.status;
              if ((observedStatus || result.turn.status) === "inProgress")
                codex.active.add(data.threadId);
              else codex.active.delete(data.threadId);
              return result;
            } finally {
              starting.delete(data.threadId);
            }
          }
          case "turn/interrupt": {
            const data = z.object({ threadId: id, turnId: id }).parse(p);
            own(data.threadId);
            return codex.call(method, data);
          }
          case "approval/list":
            return elicitation.list();
          case "elicitation/respond": {
            const data = z
              .object({
                id: z.union([id, z.number().int()]),
                token: z.string().uuid(),
                decision: z.enum(["accept", "decline", "cancel"]),
                content: z.unknown().optional(),
              })
              .parse(p);
            return elicitation.respond(
              data.id,
              data.token,
              data.decision,
              data.content,
            );
          }
          case "approval/respond": {
            const data = z
              .object({
                id: z.union([z.string(), z.number()]),
                allow: z.boolean(),
                answers: z.record(z.string(), z.array(z.string())).optional(),
              })
              .parse(p);
            const approval = codex.approvals.get(data.id) as
              | import("../shared/types.js").Approval
              | undefined;
            if (!approval) throw new PublicError("审批已失效");
            own(approval.params.threadId);
            let response: Json;
            if (approval.method === "item/tool/requestUserInput")
              response = {
                answers: Object.fromEntries(
                  Object.entries(data.allow ? data.answers || {} : {}).map(
                    ([k, v]) => [k, { answers: v }],
                  ),
                ),
              };
            else if (approval.method === "mcpServer/elicitation/request") {
              if (!isMcpToolConsent(approval) && !data.allow) {
                const current = elicitation.publicApproval(approval);
                return elicitation.respond(
                  data.id,
                  current.params.elicitation.token,
                  "decline",
                );
              }
              if (data.allow && !isMcpToolConsent(approval))
                throw new PublicError(
                  "当前仅支持无输入字段的 MCP 工具单次确认",
                );
              response = {
                action: data.allow ? "accept" : "decline",
                content: data.allow ? {} : null,
                _meta: null,
              };
            } else if (approval.method === "item/permissions/requestApproval") {
              response = {
                permissions: data.allow ? approval.params.permissions : {},
                scope: "turn",
              };
            } else response = { decision: data.allow ? "accept" : "decline" };
            codex.respond(data.id, response);
            db.audit(
              approval.method,
              approval.params.threadId,
              data.allow ? "allow-once" : "deny",
            );
            return {};
          }
          case "skills/config/write": {
            const data = z
              .object({ path: z.string(), enabled: z.boolean() })
              .parse(p);
            if (!skills.some((s) => s.path === data.path))
              throw new PublicError("未知 Skill");
            if (skills.some((s) => s.path === data.path && s.pluginId))
              throw new PublicError("请在所属插件中管理此技能");
            if (codex.extensionRuntime) {
              codex.extensionRuntime.setSkill(data.path, data.enabled);
              events.publish({
                type: EventType.CUSTOM,
                name: "newbot.configuration.changed",
                value: { scope: "extensions" },
              });
              return {};
            }
            return codex.call(method, data);
          }
          case "skills/uninstall": {
            const selected = await library.read(z.string().regex(/^[a-f0-9]{64}$/).parse(p.id));
            const versioned = codex.runtimeCapabilities?.pinnedPluginRoots && configStore.extensions?.resources.packages().some((pkg) => pkg.kind === "skills" && selected.skill.path.startsWith(pkg.path + "/"));
            if (!versioned) requireIdle();
            if (!versioned) maintenance = true;
            try {
              const data = z
                .strictObject({
                  action: z.literal("skills/uninstall").optional(),
                  id: z.string().regex(/^[a-f0-9]{64}$/),
                  sha256: z.string().regex(/^[a-f0-9]{64}$/),
                })
                .parse(p);
              if (!versioned && inputs.references("skills", data.id))
                throw new PublicError("下一条消息仍引用此技能，请先移除引用");
              const result = await library.uninstall(data.id, data.sha256);
              db.audit("skills/uninstall", data.id, "archived");
              return result;
            } finally {
              if (!versioned) maintenance = false;
            }
          }
          case "mcp/oauth": {
            requireIdle();
            const name = id.parse(p.name);
            const probeThread = await discoveryThread(false, connections.owner(name)?.pluginId || "");
            const catalog = await apps.refresh(probeThread, "");
            if (!catalog.some((s) => s.name === name))
              throw new PublicError("未知 MCP Server");
            if (oauthUntil > Date.now())
              throw new PublicError("已有 OAuth 授权正在进行");
            oauthUntil = Date.now() + 600000;
            const generation = ++oauthGeneration;
            oauthLoginId = undefined;
            oauthPending = true;
            oauthEarlyCompletions.clear();
            try {
              const result = await codex.call("mcpServer/oauth/login", {
                name,
                ...(probeThread ? { threadId: probeThread } : {}),
              });
              if (generation !== oauthGeneration) throw new PublicError("授权请求已过期，请重新连接账号");
              oauthLoginId = result.loginId;
              oauthPending = false;
              if (result.loginId && oauthEarlyCompletions.has(result.loginId)) { oauthUntil = 0; oauthLoginId = undefined; }
              oauthEarlyCompletions.clear();
              return result;
            } catch (e) {
              if (generation === oauthGeneration) {
                oauthLoginId = undefined;
                oauthPending = false;
                oauthEarlyCompletions.clear();
                oauthUntil = 0;
              }
              throw e;
            }
          }
          case "mcp/reload":
            return await mcpOperation(method, p);
          case "settings/defaults": {
            requireIdle();
            maintenance = true;
            try {
              const result = await configStore.writeDefaults(
                p,
                async (modelId, effort) => {
                  const found: Json[] = [];
                  let cursor: string | undefined;
                  for (let page = 0; page < 20; page++) {
                    const response = await codex.call("model/list", {
                      limit: 100,
                      ...(cursor ? { cursor } : {}),
                    });
                    found.push(...response.data.filter((m) => !m.hidden));
                    cursor = response.nextCursor || undefined;
                    if (!cursor) break;
                  }
                  const model = found.find((m) => m.model === modelId);
                  if (
                    !model ||
                    !model.supportedReasoningEfforts.some(
                      (e: Json) => e.reasoningEffort === effort,
                    )
                  )
                    throw new PublicError(
                      "无效模型设置，请从当前发现的模型和推理强度中选择",
                    );
                  models = found;
                },
              );
              currentModel =
                result.configuration.defaults.model || currentModel;
              currentEffort =
                result.configuration.defaults.effort || currentEffort;
              db.audit("settings/defaults", "runtime", result.state);
              return result;
            } catch (error) {
              db.audit("settings/defaults", "runtime", "failed-or-unconfirmed");
              const issue = publicConfigurationIssue(error);
              if (issue && issue.persistence !== "unchanged") {
                try {
                  const actual = await configStore.read();
                  currentModel =
                    actual.publicView.defaults.model || currentModel;
                  currentEffort =
                    actual.publicView.defaults.effort || currentEffort;
                } catch {
                  codex.offline("默认配置状态未确认，请重新连接后读取配置");
                }
              }
              throw error;
            } finally {
              maintenance = false;
            }
          }
          case "app/open": {
            const data = z
              .object({
                threadId: id,
                itemId: id,
                turnId: id.optional(),
                requestId: z.string().uuid().optional(),
              })
              .strict()
              .parse(p);
            own(data.threadId);
            const operation = apps.begin(
              data.requestId || crypto.randomUUID(),
              context?.sessionId,
            );
            let record: ReturnType<typeof apps.open> | undefined;
            try {
              if (codex.state !== "ready")
                appFail(
                  "runtime",
                  "Codex 暂不可用，请恢复连接后重新打开应用",
                  503,
                );
              const session = runtimeSettings.applied(data.threadId);
              await codex.resume(
                data.threadId,
                session.provider,
                session.approval,
                session.model || undefined,
              );
              operation.check();
              await apps.refresh(data.threadId);
              operation.check();
              let cursor: string | undefined;
              const cursors = new Set<string>();
              for (let page = 0; page < 50; page++) {
                const result = await codex.call("thread/items/list", {
                  threadId: data.threadId,
                  ...(data.turnId ? { turnId: data.turnId } : {}),
                  limit: 100,
                  sortDirection: "desc",
                  ...(cursor ? { cursor } : {}),
                });
                operation.check();
                const entry = result.data.find(
                  (e) =>
                    e.item.id === data.itemId &&
                    (!data.turnId || e.turnId === data.turnId),
                );
                if (entry) {
                  apps.register(data.threadId, entry.item, entry.turnId);
                  record = apps.open(
                    data.threadId,
                    entry.item,
                    entry.turnId,
                    data.requestId,
                    context?.sessionId,
                  );
                  break;
                }
                cursor = result.nextCursor || undefined;
                if (!cursor) break;
                if (cursors.has(cursor))
                  appFail("history", "历史记录未完整读取，请重新打开", 502);
                cursors.add(cursor);
              }
              if (!record)
                appFail(
                  "history",
                  "未找到这条工具结果，请重新加载对应历史后打开",
                  404,
                );
              const html = sandboxDocument(await apps.resource(record));
              operation.check();
              apps.status(record.token, context?.sessionId);
              return {
                token: record.token,
                html,
                input: record.input,
                result: record.result,
                tools: [...record.tools],
                expiresAt: record.expires,
                hostPolicy: appHostPolicy(record.tools.size > 0),
                display: toolNames.get(
                  record.threadId,
                  record.server,
                  record.tool,
                ),
                source: {
                  threadId: record.threadId,
                  turnId: record.turnId,
                  itemId: record.itemId,
                  server: record.server,
                  tool: record.tool,
                },
              };
            } catch (error) {
              if (record) apps.close(record.token, context?.sessionId);
              if (error instanceof AppFailure) throw error;
              appFail("unavailable", "应用加载失败，请检查连接后重新打开", 502);
            } finally {
              operation.finish();
            }
          }
          case "app/call/request": {
            const data = z
              .object({
                token: id,
                tool: id,
                arguments: z.record(z.string(), z.unknown()),
              })
              .parse(p);
            const record = await apps.authorize(
              data.token,
              data.tool,
              context?.sessionId,
            );
            own(record.threadId);
            const receiverRevision = appConfigurationRevision(record.threadId);
            await checkAppConfiguration(record.threadId, record.server);
            const automatic = await appAutomaticPolicy(record.threadId);
            if (receiverRevision !== appConfigurationRevision(record.threadId))
              appFail("permission", "连接器配置已变化，请重新发起操作", 403);
            apps.validate(data.token, data.tool, context?.sessionId);
            for (const [key, grant] of grants)
              if (grant.expires < Date.now()) grants.delete(key);
            if (grants.size >= 100) throw new PublicError("待审批请求过多");
            const grant = crypto.randomUUID();
            grants.set(grant, {
              recordToken: data.token,
              tool: data.tool,
              args: data.arguments,
              expires: Math.min(Date.now() + 120000, record.expires),
              automatic,
            });
            return {
              grant,
              authorization: automatic ? "session-policy" : "user",
              server: record.server,
              tool: data.tool,
              display: toolNames.get(record.threadId, record.server, data.tool),
              expiresAt: Math.min(Date.now() + 120000, record.expires),
            };
          }
          case "app/call/approve": {
            const data = z
              .object({ grant: id, allow: z.boolean(), authorization: z.enum(["user", "session-policy"]).optional() })
              .strict()
              .parse(p);
            const grant = grants.get(data.grant);
            if (grant) {
              const current = apps.live(grant.recordToken);
              if (current && current.owner !== context?.sessionId)
                appFail("permission", "此授权不属于当前浏览器会话", 403);
            }
            grants.delete(data.grant);
            if (!grant || grant.expires <= Date.now())
              appFail(
                "approval_expired",
                "授权已失效，请重新发起应用操作",
                410,
              );
            if (!data.allow) {
              db.audit("mcp-app-tool", grant.tool, "deny");
              appFail("permission", "用户拒绝了工具调用", 403);
            }
            const record = await apps.authorize(
              grant.recordToken,
              grant.tool,
              context?.sessionId,
            );
            own(record.threadId);
            const receiverRevision = appConfigurationRevision(record.threadId);
            await checkAppConfiguration(record.threadId, record.server);
            if (data.authorization === "session-policy") {
              const policy = await appAutomaticPolicy(record.threadId);
              if (!grant.automatic || !policy || policy.version !== grant.automatic.version || policy.privateRevision !== grant.automatic.privateRevision)
                appFail("permission", "会话权限或凭证已变化，请重新发起操作", 403);
            }
            if (receiverRevision !== appConfigurationRevision(record.threadId))
              appFail("permission", "连接器配置已变化，请重新发起操作", 403);
            apps.validate(grant.recordToken, grant.tool, context?.sessionId);
            db.audit(
              "mcp-app-tool",
              `${record.server}/${grant.tool}`,
              data.authorization === "session-policy" ? "session-policy:full" : "allow-once",
            );
            try {
              return appToolResult(
                await codex.call("mcpServer/tool/call", {
                  threadId: record.threadId,
                  server: record.server,
                  tool: grant.tool,
                  arguments: grant.args,
                }),
              );
            } catch {
              appFail(
                "unavailable",
                "应用工具调用失败，请检查 MCP 连接后重试",
                502,
              );
            }
          }
          default:
            throw new PublicError("不支持的方法");
        }
      } finally {
        inflight--;
      }
    },
  };
}
