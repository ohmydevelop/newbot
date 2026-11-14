import type { SubmissionPreview } from "./submission-preview";
import {
  pendingFor,
  restorePending,
  type PendingSubmission,
} from "./pending-runs";
import { responseJson } from "./http";
import { resourceLoadFailure } from "./resource-errors";
import { ThreadCache } from "./thread-cache";
import { appIssue } from "../shared/mcp-apps";
import {
  configurationIssue,
  type ConfigurationIssue,
} from "../shared/configuration";
import { create } from "zustand";
import { failureTarget } from "./chat-presentation";
import { EventType, type Event } from "@ag-ui/core";
import { reduceAgentEvent } from "../shared/events";
import { mergeOlderHistory, mergeRecentHistory } from "../shared/history";
import type {
  Approval,
  Json,
  Model,
  Thread,
  ThreadSummary,
} from "../shared/types";
type State = {
  mcpOAuthCompletions: Record<string, { name: string; loginId: string; success: boolean }>;
  authenticated: boolean | null;
  pendingRun: string | null;
  pendingRuns: Record<string, PendingSubmission>;
  newDraftKey: string;
  abandonUnseen: boolean;
  connected: boolean;
  connectionResourceError: boolean;
  runtime: string;
  runtimeReason: string;
  credentialProbe: boolean;
  credentialManagement: boolean;
  credentialEncryption: boolean;
  sudoIdentity: { available: boolean; policy: string | null } | null;
  artifactRegistration: boolean;
  htmlPreview: boolean;
  pdfPreview: boolean;
  skillDocuments: boolean;
  skillSelection: boolean;
  pluginSelection: boolean;
  expertSelection: boolean;
  configurationEditing: boolean;
  providerManagement: boolean;
  mcpManagement: boolean;
  appLifecycle: boolean;
  configurationRecovery: boolean;
  settingsLoading: boolean;
  settingsError: string;
  artifactVersions: boolean;
  storageManagement: boolean;
  error: string;
  backgroundFailure: { threadId: string; runId: string | null } | null;
  threads: ThreadSummary[];
  threadsLoading: boolean;
  threadsError: string;
  olderLoading: boolean;
  olderError: string;
  thread: Thread | null;
  selectedId: string | null;
  loading: boolean;
  threadError: string;
  settings: Json | null;
  approvals: Approval[];
  model: string;
  provider: string;
  effort: string;
  theme: string;
  sidebar: boolean;
  desktopSidebar: boolean;
  gatewayCollapsed: Record<string, boolean>;
  set: (value: Partial<State>) => void;
  notify: (error: unknown) => void;
};
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem("ma_preferences") || "{}");
  } catch {
    return {};
  }
})();
export const useApp = create<State>((set) => ({
  authenticated: null,
  mcpOAuthCompletions: {},
  pendingRun: null,
  pendingRuns: restorePending(sessionStorage.getItem("ma_pending_runs")),
  newDraftKey: sessionStorage.getItem("ma_new_draft") || "$new",
  abandonUnseen: false,
  connected: false,
  connectionResourceError: false,
  runtime: "starting",
  runtimeReason: "",
  credentialProbe: false,
  credentialManagement: false,
  credentialEncryption: false,
  sudoIdentity: null,
  artifactRegistration: false,
  htmlPreview: false,
  pdfPreview: false,
  skillDocuments: false,
  skillSelection: false,
  pluginSelection: false,
  expertSelection: false,
  configurationEditing: false,
  providerManagement: false,
  mcpManagement: false,
  appLifecycle: false,
  configurationRecovery: false,
  settingsLoading: true,
  settingsError: "",
  artifactVersions: false,
  storageManagement: false,
  error: "",
  backgroundFailure: null,
  threads: [],
  threadsLoading: false,
  threadsError: "",
  olderLoading: false,
  olderError: "",
  thread: null,
  selectedId: saved.threadId || null,
  loading: false,
  threadError: "",
  settings: null,
  approvals: [],
  model: saved.model || "",
  provider: "",
  effort: saved.effort || "",
  theme: ["light", "dark", "system"].includes(saved.theme)
    ? saved.theme
    : "system",
  sidebar: window.innerWidth > 760 && saved.sidebar !== false,
  desktopSidebar: saved.sidebar !== false,
  gatewayCollapsed:
    saved.gatewayCollapsed &&
    typeof saved.gatewayCollapsed === "object" &&
    !Array.isArray(saved.gatewayCollapsed)
      ? Object.fromEntries(
          Object.entries(saved.gatewayCollapsed).flatMap(([key, value]) =>
            key.length <= 128 && typeof value === "boolean"
              ? [[key, value] as [string, boolean]]
              : [],
          ),
        )
      : {},
  set: (value) =>
    set({
      ...value,
      ...(typeof value.sidebar === "boolean" && window.innerWidth > 760
        ? { desktopSidebar: value.sidebar }
        : {}),
    }),
  notify: (e) => set({ error: e instanceof Error ? e.message : String(e) }),
}));
// Navigation selects its own pending request; unrelated conversations remain usable.
useApp.subscribe((state) => {
  const selected =
    pendingFor(state.pendingRuns, state.selectedId, state.newDraftKey)?.id ||
    null;
  if (state.pendingRun !== selected) useApp.setState({ pendingRun: selected });
  try {
    sessionStorage.setItem(
      "ma_pending_runs",
      JSON.stringify(state.pendingRuns),
    );
    sessionStorage.setItem("ma_new_draft", state.newDraftKey);
  } catch {
    /* Live request ownership remains in memory if browser storage is full. */
  }
});
const legacyRun = sessionStorage.getItem("ma_pending_run_id");
if (legacyRun) {
  useApp.setState((s) => ({
    pendingRuns: {
      ...s.pendingRuns,
      [legacyRun]: {
        id: legacyRun,
        origin: s.selectedId || s.newDraftKey,
        fingerprint: sessionStorage.getItem("ma_pending_run_fingerprint") || "",
        state: "unknown",
      },
    },
  }));
  sessionStorage.removeItem("ma_pending_run_id");
  sessionStorage.removeItem("ma_pending_run_fingerprint");
}

let lastPreferences = "";
useApp.subscribe((s) => {
  const preferences = JSON.stringify({
    threadId: s.selectedId,
    model: s.model,
    effort: s.effort,
    theme: s.theme,
    gatewayCollapsed: s.gatewayCollapsed,
    sidebar: s.desktopSidebar,
  });
  if (preferences !== lastPreferences) {
    lastPreferences = preferences;
    try {
      localStorage.setItem("ma_preferences", preferences);
    } catch {
      /* Preferences must not stop live state updates when storage is full. */
    }
  }
});
let source: EventSource | undefined;
let controller: AbortController | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let connectionGeneration = 0;
let loadVersion = 0;
const threadCache = new ThreadCache();
let hydrating: string | null = null;
let buffer: Event[] = [];
let bufferBytes = 0;
let bufferOverflow = false;
const seenFailures = new Set<string>();
export async function request<T = any>(
  method: string,
  params: Json = {},
  options: Pick<RequestInit, "signal" | "keepalive"> & {
    operationId?: string;
  } = {},
): Promise<T> {
  const requestGeneration = connectionGeneration;
  let path = "/api/agent/action";
  let verb = "POST";
  let body: Json | undefined = { action: method, ...params };
  if (method === "settings/read") {
    path = "/api/config?view=saved";
    verb = "GET";
    body = undefined;
  }
  if (method === "thread/list") {
    path = "/api/threads";
    verb = "GET";
    body = undefined;
  }
  if (method === "thread/read") {
    path = `/api/threads/${encodeURIComponent(params.threadId)}${params.cursor ? `?cursor=${encodeURIComponent(params.cursor)}` : ""}`;
    verb = "GET";
    body = undefined;
  }
  if (method === "run/status") {
    path = `/api/agent/runs/${encodeURIComponent(params.requestId)}`;
    verb = "GET";
    body = undefined;
  }
  if (method === "turn/start") {
    path = "/api/agent/run";
    body = params;
  }
  if (
    [
      "skills/config/write",
      "settings/defaults",
      "provider/save",
      "gateway/save",
      "provider/delete",
      "mcp/save",
      "mcp/delete",
      "mcp/enabled",
    ].includes(method)
  ) {
    path = "/api/config";
    body = { action: method, ...params };
  }
  if (method.startsWith("app/")) {
    path = `/api/mcp-apps/${method.slice(4).replaceAll("/", "-")}`;
    body = params;
  }
  const mutating = [
    "gateway/save",
    "gateway/defaults",
    "skills/config/write",
    "plugin/enabled",
    "plugin/skill/enabled",
    "plugin/install",
    "plugin/update",
    "plugin/uninstall",
    "settings/defaults",
    "provider/save",
    "provider/delete",
    "provider/switch",
    "mcp/save",
    "mcp/delete",
    "mcp/enabled",
  ].includes(method);
  const transportFailure = () =>
    Object.assign(
      new Error(
        mutating
          ? "连接中断，保存结果尚未确认，请先读取当前配置"
          : "连接中断，请重新读取当前状态",
      ),
      {
        operationId,
        configurationIssue: {
          code: mutating ? "write_unconfirmed" : "read_failed",
          persistence: "unconfirmed",
          recovery: "read",
        } as ConfigurationIssue,
      },
    );
  const operationId =
    mutating && (path === "/api/config" || method === "gateway/defaults")
      ? options.operationId || crypto.randomUUID()
      : undefined;
  const savedReceipt = async (): Promise<T | undefined> => {
    if (!operationId) return;
    try {
      const response = await fetch(`/api/config/operations/${operationId}`);
      if (!response.ok) return;
      const receipt = await responseJson(response);
      if (receipt.state === "saved") return receipt.result as T;
    } catch {
      /* Leave the unknown write visible; never repeat the mutation. */
    }
  };
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      method: verb,
      headers: body
        ? {
            "Content-Type": "application/json",
            ...(operationId ? { "x-newbot-operation-id": operationId } : {}),
          }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const receipt = await savedReceipt();
    if (receipt) return receipt;
    if (
      mutating ||
      method === "settings/read" ||
      method === "configuration/recover"
    )
      throw transportFailure();
    throw error;
  }
  if (response.status === 401) {
    if (requestGeneration === connectionGeneration && !options.signal?.aborted)
      useApp.setState({ authenticated: false });
    throw new Error("登录已过期");
  }
  let value: Json;
  try {
    value = await responseJson(response);
  } catch (error) {
    const receipt = await savedReceipt();
    if (receipt) return receipt;
    if (
      mutating ||
      method === "settings/read" ||
      method === "configuration/recover"
    )
      throw transportFailure();
    throw error;
  }
  if (!response.ok)
    throw Object.assign(new Error(value.error || "请求失败"), {
      status: response.status,
      configurationIssue: configurationIssue(value.configurationIssue),
      appIssue: appIssue(value.appIssue),
    });
  return value as T;
}
function readOptions(options: unknown): Pick<RequestInit, "signal"> {
  return options &&
    typeof options === "object" &&
    "signal" in options &&
    options.signal instanceof AbortSignal
    ? { signal: options.signal }
    : {};
}
const discovering = new Map<string, Promise<void>>();
export function loadDiscovery(section: "models" | "skills" | "mcp") {
  const current = discovering.get(section);
  if (current) return current;
  const generation = connectionGeneration;
  const revision = useApp.getState().settings?.configuration?.revision;
  let operation!: Promise<void>;
  operation = (async () => {
    const response = await fetch(`/api/config/discovery?section=${section}`);
    if (generation !== connectionGeneration) return;
    if (response.status === 401) {
      useApp.setState({ authenticated: false });
      return;
    }
    if (!response.ok) throw new Error("目录读取失败，请刷新重试。");
    const value = await responseJson(response);
    if (generation !== connectionGeneration) return;
    if (revision !== useApp.getState().settings?.configuration?.revision) {
      if (discovering.get(section) === operation) discovering.delete(section);
      void loadDiscovery(section);
      return;
    }
    useApp.setState((s) => ({
      settings: s.settings
        ? {
            ...s.settings,
            ...value,
            errors: (s.settings.errors || []).filter(
              (e: Json) => e.section !== section,
            ),
          }
        : s.settings,
    }));
  })()
    .catch(() => {
      if (generation === connectionGeneration)
        useApp.setState((s) => ({
          settings: s.settings
            ? {
                ...s.settings,
                errors: [
                  ...(s.settings.errors || []).filter(
                    (e: Json) => e.section !== section,
                  ),
                  { section, message: "目录读取失败，请刷新重试。" },
                ],
              }
            : s.settings,
        }));
    })
    .finally(() => {
      if (discovering.get(section) === operation) discovering.delete(section);
    });
  discovering.set(section, operation);
  return operation;
}
let settingsVersion = 0;
export async function loadSettings(options?: unknown) {
  const version = ++settingsVersion;
  useApp.setState({ settingsLoading: true, settingsError: "" });
  try {
    const settings = await request<Json>(
      "settings/read",
      {},
      readOptions(options),
    );
    if (version === settingsVersion) {
      const old = useApp.getState().settings;
      acceptSettings(settings);
      if (!old)
        for (const section of ["models", "skills", "mcp"] as const)
          void loadDiscovery(section);
    }
  } catch (error) {
    if (version === settingsVersion)
      useApp.setState({
        settingsLoading: false,
        settingsError: error instanceof Error ? error.message : "配置读取失败",
      });
    throw error;
  }
}
export function acceptSettings(settings: Json) {
  ++settingsVersion;
  const s = useApp.getState();
  const configuredId = settings.configuration?.defaults.model || settings.model;
  const useConfigured =
    s.configurationEditing && !s.settings && !s.selectedId && !!configuredId;
  const chosenId =
    s.thread?.runtime?.model ||
    (useConfigured ? configuredId : s.model) ||
    configuredId ||
    settings.models.find((m: Model) => m.isDefault)?.model ||
    settings.models[0]?.model ||
    "";
  const model = settings.models.find((m: Model) => m.model === chosenId);
  useApp.setState({
    settings,
    settingsLoading: false,
    settingsError: "",
    model: chosenId,
    provider:
      s.thread?.runtime?.provider ||
      s.provider ||
      settings.providers.find((p: Json) => p.current)?.id ||
      "",
    effort:
      s.thread?.runtime?.effort ??
      (s.model && !useConfigured
        ? s.effort
        : model?.supportedReasoningEfforts.some(
              (e: Json) =>
                e.reasoningEffort ===
                (useConfigured
                  ? settings.configuration?.defaults.effort
                  : s.effort),
            )
          ? useConfigured
            ? settings.configuration.defaults.effort
            : s.effort
          : model?.defaultReasoningEffort || ""),
  });
}

let listVersion = 0;
export async function loadThreads(options?: unknown) {
  const version = ++listVersion;
  useApp.setState({ threadsLoading: true, threadsError: "" });
  try {
    const threads = await request<ThreadSummary[]>(
      "thread/list",
      {},
      readOptions(options),
    );
    if (version === listVersion)
      useApp.setState((s) => ({
        threads: threads.map((t) => {
          const prior = s.threads.find((p) => p.id === t.id)?.activity;
          return prior && prior.revision > (t.activity?.revision || 0)
            ? { ...t, activity: prior }
            : t;
        }),
        threadsLoading: false,
      }));
  } catch (error) {
    if (version === listVersion)
      useApp.setState({
        threadsLoading: false,
        threadsError: "对话列表未能读取，请重试。",
      });
    throw error;
  }
}
export async function loadOlder() {
  const state = useApp.getState(),
    current = state.thread,
    cursor = current?.historyCursor,
    version = loadVersion;
  if (!current || !cursor || state.loading || state.olderLoading) return;
  useApp.setState({ olderLoading: true, olderError: "" });
  try {
    const older = await request<Thread>("thread/read", {
      threadId: current.id,
      cursor,
    });
    const actual = useApp.getState().thread;
    if (
      version !== loadVersion ||
      actual?.id !== current.id ||
      actual.historyCursor !== cursor
    )
      return;
    useApp.setState({ thread: mergeOlderHistory(actual, older, cursor) });
  } catch {
    if (version === loadVersion)
      useApp.setState({ olderError: "更早的消息未能加载，请重试。" });
  } finally {
    if (version === loadVersion) useApp.setState({ olderLoading: false });
  }
}
export async function loadThread(
  id: string,
  resume = false,
  options: {
    localError?: boolean;
    signal?: AbortSignal;
    recoveryRead?: boolean;
  } = {},
) {
  const localFailure = options.localError === true;
  const previous = useApp.getState().thread;
  threadCache.remember(previous);
  const preview = previous?.id === id ? previous : threadCache.get(id);
  const version = ++loadVersion;
  hydrating = id;
  buffer = [];
  bufferBytes = 0;
  bufferOverflow = false;
  let reload = false;
  useApp.setState({
    selectedId: id,
    thread: preview,
    loading: true,
    threadError: "",
    ...(preview?.runtime
      ? {
          provider: preview.runtime.provider,
          model: preview.runtime.model,
          effort: preview.runtime.effort,
        }
      : {}),
    olderLoading: false,
    olderError: "",
    ...(localFailure ? {} : { error: "" }),
  });
  try {
    let thread = await request<Thread>(
      resume ? "thread/resume" : "thread/read",
      { threadId: id },
      { signal: options.signal },
    );
    if (version !== loadVersion) return;
    if (bufferOverflow) {
      if (options.recoveryRead)
        throw new Error("消息更新较快，请重新读取对话状态。");
      reload = true;
    }
    if (!reload) {
      const prior = useApp.getState().thread;
      if (prior?.id === id) thread = mergeRecentHistory(prior, thread);
      for (const event of buffer)
        if (
          !event.metadata?.revision ||
          event.metadata.revision > (thread.revision || 0)
        )
          thread = reduceAgentEvent(thread, event, true);
      useApp.setState({
        thread,
        loading: false,
        threadError: "",
        provider:
          thread.runtime?.provider ||
          thread.modelProvider ||
          useApp.getState().provider,
        ...(thread.runtime?.model
          ? { model: thread.runtime.model, effort: thread.runtime.effort }
          : {}),
        ...(useApp.getState().backgroundFailure?.threadId === id
          ? { backgroundFailure: null }
          : {}),
      });
    }
  } catch (e) {
    if (version === loadVersion)
      useApp.setState({
        loading: false,
        threadError: "对话未能更新，请重试后继续。",
        ...(localFailure ? {} : { error: (e as Error).message }),
      });
    if (localFailure) throw e;
  } finally {
    if (version === loadVersion) {
      hydrating = null;
      buffer = [];
      bufferBytes = 0;
      bufferOverflow = false;
    }
  }
  if (reload && version === loadVersion)
    await loadThread(id, false, { ...options, recoveryRead: true });
}
export function newChat(draftKey = `$new:${crypto.randomUUID()}`) {
  threadCache.remember(useApp.getState().thread);
  ++loadVersion;
  hydrating = null;
  buffer = [];
  bufferBytes = 0;
  bufferOverflow = false;
  const current = useApp.getState();
  const defaults = current.configurationEditing
    ? current.settings?.configuration?.defaults
    : null;
  const selectedId =
    defaults?.model ||
    current.settings?.model ||
    current.settings?.models.find((m: Model) => m.isDefault)?.model ||
    current.settings?.models[0]?.model ||
    "";
  const selected = current.settings?.models.find(
    (m: Model) => m.model === selectedId,
  );
  const defaultEffort = selected?.supportedReasoningEfforts.some(
    (e: Json) => e.reasoningEffort === defaults?.effort,
  )
    ? defaults.effort
    : selected?.defaultReasoningEffort;
  useApp.setState({
    newDraftKey: draftKey,
    selectedId: null,
    thread: null,
    error: "",
    loading: false,
    threadError: "",
    olderLoading: false,
    olderError: "",
    model: selectedId,
    effort: defaultEffort || "",
    provider:
      useApp.getState().settings?.providers.find((p: Json) => p.current)?.id ||
      "",
  });
}
function recordScopedFailure(event: Event) {
  const target = failureTarget(event);
  if (!target) return false;
  const key = JSON.stringify([
    target.threadId,
    target.runId || event.metadata?.revision || 0,
  ]);
  if (!seenFailures.has(key)) {
    seenFailures.add(key);
    while (seenFailures.size > 128)
      seenFailures.delete(seenFailures.values().next().value!);
    if (target.threadId !== useApp.getState().selectedId)
      useApp.setState({ backgroundFailure: target });
  }
  return true;
}
export function consume(event: Event) {
  if (hydrating && !bufferOverflow) {
    const bytes = JSON.stringify(event).length * 2;
    if (buffer.length >= 1024 || bufferBytes + bytes > 4 * 1024 * 1024) {
      buffer = [];
      bufferBytes = 0;
      bufferOverflow = true;
    } else {
      buffer.push(event);
      bufferBytes += bytes;
    }
  }
  if (event.type === EventType.CUSTOM) {
    const value = event.value;
    if (event.name === "newbot.mcp.oauth.completed") {
      if (typeof value.loginId === "string") useApp.setState(s => {
        const completions: State["mcpOAuthCompletions"] = { ...s.mcpOAuthCompletions, [value.loginId]: { name: String(value.name), loginId: value.loginId, success: value.success === true } };
        for (const key of Object.keys(completions).slice(0, -32)) delete completions[key];
        return { mcpOAuthCompletions: completions };
      });
      void loadDiscovery("mcp");
      return;
    }
    if (
      [
        "newbot.session.runtime",
        "newbot.session.inputs",
        "newbot.session.extensions",
      ].includes(event.name)
    ) {
      useApp.setState((s) => {
        const thread = s.thread
          ? reduceAgentEvent(s.thread, event, true)
          : null;
        return {
          thread,
          ...(event.name === "newbot.session.runtime" &&
          thread &&
          thread.id === value.threadId &&
          thread.runtime
            ? {
                provider: thread.runtime.provider,
                model: thread.runtime.model,
                effort: thread.runtime.effort,
              }
            : {}),
        };
      });
      return;
    }
    if (
      event.name === "newbot.activity" ||
      event.name === "newbot.activity.snapshot"
    ) {
      const rows = event.name === "newbot.activity" ? [value] : value;
      useApp.setState((s) => ({
        threads: s.threads.map((t) => {
          const row = rows.find((r: Json) => r.threadId === t.id);
          return row && row.activity.revision >= (t.activity?.revision || 0)
            ? { ...t, activity: row.activity }
            : t;
        }),
      }));
      if (
        rows.some(
          (r: Json) =>
            !useApp.getState().threads.some((t) => t.id === r.threadId),
        )
      )
        void loadThreads().catch(() => {});
      return;
    }
    if (event.name === "newbot.runtime") {
      const before = useApp.getState().runtime;
      useApp.setState({
        runtime: value.state,
        runtimeReason: value.reason || "",
        ...(value.state === "offline" ? { approvals: [] } : {}),
      });
      if (value.state === "ready" && before !== "ready")
        void loadSettings().catch(useApp.getState().notify);
      return;
    }
    if (event.name === "newbot.approval.snapshot") {
      useApp.setState({ approvals: value });
      return;
    }
    if (event.name === "newbot.configuration.changed") {
      if (value.configuration && useApp.getState().settings) {
        ++settingsVersion;
        useApp.setState((s) => ({
          settings: { ...s.settings, configuration: value.configuration },
          settingsLoading: false,
          settingsError: "",
        }));
      } else if (value.scope !== "experts")
        void loadSettings().catch(useApp.getState().notify);
      return;
    }
    if (event.name === "newbot.approval.request") {
      useApp.setState((s) => ({
        approvals: [...s.approvals.filter((a) => a.id !== value.id), value],
      }));
      return;
    }
    if (event.name === "newbot.approval.resolved") {
      useApp.setState((s) => ({
        approvals: s.approvals.filter((a) => a.id !== value.id),
      }));
      return;
    }
    if (event.name === "newbot.elicitation.expired") {
      if (value.threadId === useApp.getState().selectedId)
        useApp.getState().notify(new Error("MCP 输入请求已超时并取消。"));
      return;
    }
    if (event.name === "newbot.notice") {
      if (recordScopedFailure(event))
        useApp.setState((s) => ({
          thread: s.thread ? reduceAgentEvent(s.thread, event, true) : null,
        }));
      else useApp.getState().notify(value.message);
    }
    return;
  }
  useApp.setState((s) => ({
    thread: s.thread ? reduceAgentEvent(s.thread, event, true) : null,
  }));
  if (
    event.type === EventType.RUN_FINISHED ||
    event.type === EventType.RUN_ERROR
  ) {
    void loadThreads().catch(() => {});
    if (event.type === EventType.RUN_ERROR) {
      if (!recordScopedFailure(event)) useApp.getState().notify(event.message);
    }
  }
}
async function syncConnection(generation: number, signal: AbortSignal) {
  const valid = () => generation === connectionGeneration && !signal.aborted;
  if (!valid()) return;
  useApp.setState({ connected: true, error: "" });
  const id = useApp.getState().selectedId;
  await Promise.all([
    loadSettings({ signal }),
    loadThreads({ signal }).catch(() => {}),
    request<Approval[]>("approval/list", {}, { signal }).then((approvals) => {
      if (valid()) useApp.setState({ approvals });
    }),
    ...(id ? [loadThread(id, false, { signal })] : []),
  ]);
}
export function connect() {
  if (source || controller) return;
  const generation = ++connectionGeneration;
  const abort = new AbortController();
  controller = abort;
  useApp.setState({ connectionResourceError: false });
  const valid = () =>
    generation === connectionGeneration && !abort.signal.aborted;
  let syncFlight: Promise<void> | undefined;
  const sync = () => {
    if (!syncFlight)
      syncFlight = syncConnection(generation, abort.signal).finally(() => {
        syncFlight = undefined;
      });
    return syncFlight;
  };
  void (async () => {
    const schema = import("@ag-ui/core/schemas");
    void schema.catch(() => {}); // The awaited failure below owns the connection error.
    const response = await fetch("/api/runtime/capabilities", {
      signal: abort.signal,
    });
    if (!valid()) return;
    if (response.status === 401) {
      useApp.setState({ authenticated: false });
      disconnect();
      return;
    }
    if (!response.ok) throw new Error("无法读取连接能力");
    const capabilities = await responseJson(response);
    if (!valid()) return;
    useApp.setState({
      abandonUnseen:
        capabilities.capabilities?.runRecovery?.abandonUnseen === true,
      configurationRecovery:
        capabilities.capabilities?.configuration?.recovery === true,
      appLifecycle: capabilities.capabilities?.mcpAppLifecycle?.leases === true,
      mcpManagement:
        capabilities.capabilities?.mcpManagement?.configuration === true,
      providerManagement:
        capabilities.capabilities?.providerManagement?.configuration === true,
      configurationEditing:
        capabilities.capabilities?.configuration?.versionedDefaults === true,
      credentialManagement:
        capabilities.capabilities?.trustedInput?.persistence === true,
      credentialEncryption:
        capabilities.capabilities?.trustedInput?.storage?.encrypted === true,
      credentialProbe:
        capabilities.capabilities?.trustedInput?.apiKeyProbe === true,
      sudoIdentity:
        capabilities.capabilities?.trustedInput?.sudoIdentity || null,
      artifactRegistration:
        capabilities.capabilities?.artifacts?.registration === true,
      htmlPreview: capabilities.capabilities?.artifacts?.htmlExecution === true,
      pdfPreview: capabilities.capabilities?.artifacts?.pdfPreview === true,
      skillDocuments: capabilities.capabilities?.skillDocuments?.read === true,
      pluginSelection: capabilities.capabilities?.plugins?.available === true,
      expertSelection: capabilities.capabilities?.experts?.available === true,
      skillSelection:
        capabilities.capabilities?.skillSelection?.structuredInput === true,
      artifactVersions: capabilities.capabilities?.artifacts?.versions === true,
      storageManagement:
        capabilities.capabilities?.artifacts?.storageManagement === true,
    });
    const { EventSchema } = await schema;
    if (generation !== connectionGeneration) return;
    if (capabilities.webTransport === "poll") {
      let cursor: string | undefined;
      let online = false;
      while (!abort.signal.aborted) {
        try {
          const response = await fetch(
            `/api/agent/events?transport=poll${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            { signal: abort.signal, cache: "no-store" },
          );
          if (!valid()) return;
          if (response.status === 401) {
            useApp.setState({ authenticated: false });
            disconnect();
            return;
          }
          if (!response.ok) throw new Error("事件连接暂不可用");
          const batch = await responseJson(response);
          if (!valid()) return;
          for (const event of batch.events) consume(EventSchema.parse(event));
          cursor = batch.cursor;
          if (!online || batch.reset) {
            online = true;
            await sync();
          }
          if (valid()) useApp.setState({ connected: true });
        } catch (e) {
          if (abort.signal.aborted) return;
          online = false;
          useApp.setState({ connected: false });
        }
        await new Promise<void>((resolve) => {
          if (abort.signal.aborted) {
            resolve();
            return;
          }
          const done = () => {
            clearTimeout(timer);
            abort.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, online ? 750 : 2000);
          abort.signal.addEventListener("abort", done, { once: true });
        });
      }
      return;
    }
    source = new EventSource("/api/agent/events");
    source.onopen = () => {
      if (valid())
        void sync().catch((error) => {
          if (valid()) useApp.getState().notify(error);
        });
    };
    source.onmessage = (message) => {
      if (!valid()) return;
      try {
        consume(EventSchema.parse(JSON.parse(message.data)));
      } catch {
        useApp.getState().notify("收到不兼容的事件，请刷新页面");
      }
    };
    source.onerror = () => {
      if (!valid()) return;
      useApp.setState({ connected: false });
      void fetch("/api/session", { signal: abort.signal })
        .then((r) => responseJson(r))
        .then((r) => {
          if (valid() && !r.authenticated) {
            disconnect();
            useApp.setState({ authenticated: false });
          }
        })
        .catch(() => {});
    };
  })().catch((error) => {
    if (generation === connectionGeneration && !abort.signal.aborted) {
      controller = undefined;
      useApp.setState({
        connected: false,
        connectionResourceError: resourceLoadFailure(error),
      });
      if (!resourceLoadFailure(error))
        reconnectTimer = setTimeout(connect, 2000);
    }
  });
}
export function disconnect() {
  threadCache.clear();
  seenFailures.clear();
  ++connectionGeneration;
  ++settingsVersion;
  ++listVersion;
  ++loadVersion;
  hydrating = null;
  buffer = [];
  bufferBytes = 0;
  bufferOverflow = false;
  clearTimeout(reconnectTimer);
  controller?.abort();
  discovering.clear();
  controller = undefined;
  source?.close();
  source = undefined;
  useApp.setState({
    connected: false,
    backgroundFailure: null,
    loading: false,
    threadError: "",
    ...(!useApp.getState().authenticated ? { thread: null } : {}),
    olderLoading: false,
    threadsLoading: false,
    settingsLoading: false,
  });
}

export function updatePendingRun(id: string, status: Json) {
  useApp.setState((s) => {
    const prior = s.pendingRuns[id];
    return prior
      ? {
          pendingRuns: {
            ...s.pendingRuns,
            [id]: {
              ...prior,
              status,
              state:
                status.state === "awaiting_credentials"
                  ? "awaiting_credentials"
                  : "unknown",
            },
          },
        }
      : {};
  });
}
export function clearPendingRun(requestId?: string) {
  const id = requestId || useApp.getState().pendingRun;
  if (!id) return;
  useApp.setState((s) => {
    const next = { ...s.pendingRuns };
    delete next[id];
    return { pendingRuns: next };
  });
}
const submittingOrigins = new Set<string>();
export async function submitRun(
  payload: Json,
  reserved?: (id: string) => void,
  preview?: SubmissionPreview,
) {
  const origin = payload.threadId || useApp.getState().newDraftKey;
  if (
    submittingOrigins.has(origin) ||
    Object.values(useApp.getState().pendingRuns).some(
      (r) => r.origin === origin,
    )
  )
    throw new Error("此对话有待确认的发送，请先查询状态。");
  const requestId = crypto.randomUUID();
  submittingOrigins.add(origin);
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    const fingerprint = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    useApp.setState((s) => ({
      pendingRuns: {
        ...s.pendingRuns,
        [requestId]: {
          id: requestId,
          origin,
          fingerprint,
          preview: preview || {
            text: String(payload.text || ""),
            files: (payload.attachments || []).map((id: string) => ({
              id,
              name: "附件",
            })),
            beforeTurns:
              useApp.getState().thread?.id === origin
                ? useApp.getState().thread!.turns.map((t) => t.id)
                : [],
          },
          state: "submitting",
        },
      },
    }));
  } finally {
    submittingOrigins.delete(origin);
  }
  reserved?.(requestId);
  const timer = setTimeout(() => {
    if (useApp.getState().pendingRuns[requestId]?.state === "submitting")
      updatePendingRun(requestId, { state: "unknown" });
  }, 8000);
  function accept(result: Json) {
    if (result.turn?.id) clearPendingRun(requestId);
    else updatePendingRun(requestId, result);
    return result;
  }
  try {
    return accept(await request("turn/start", { ...payload, requestId }));
  } catch (error) {
    try {
      const response = await fetch(`/api/agent/runs/${requestId}`, {
        cache: "no-store",
      });
      if (response.status === 401) useApp.setState({ authenticated: false });
      if (response.ok) {
        const status = await responseJson<Json>(response);
        if (status.turn?.id || status.state === "awaiting_credentials")
          return accept(status);
        if (["rejected", "abandoned"].includes(status.state))
          clearPendingRun(requestId);
        else updatePendingRun(requestId, status);
      } else if (
        response.status === 404 &&
        typeof (error as Json).status === "number"
      )
        clearPendingRun(requestId);
      else updatePendingRun(requestId, { state: "unknown" });
    } catch {
      updatePendingRun(requestId, { state: "unknown" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
