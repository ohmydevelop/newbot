import { resourceLoadFailure } from "./resource-errors";
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
  authenticated: boolean | null;
  pendingRun: string | null;
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
  settings: Json | null;
  approvals: Approval[];
  model: string;
  provider: string;
  effort: string;
  theme: string;
  sidebar: boolean;
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
  pendingRun: sessionStorage.getItem("ma_pending_run_id"),
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
  settings: null,
  approvals: [],
  model: saved.model || "",
  provider: "",
  effort: saved.effort || "",
  theme: ["light", "dark", "system"].includes(saved.theme)
    ? saved.theme
    : "system",
  sidebar: window.innerWidth > 760,
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
  set,
  notify: (e) => set({ error: e instanceof Error ? e.message : String(e) }),
}));
let lastPreferences = "";
useApp.subscribe((s) => {
  const preferences = JSON.stringify({
    threadId: s.selectedId,
    model: s.model,
    effort: s.effort,
    theme: s.theme,
    gatewayCollapsed: s.gatewayCollapsed,
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
let hydrating: string | null = null;
let buffer: Event[] = [];
let bufferBytes = 0;
let bufferOverflow = false;
const seenFailures = new Set<string>();
export async function request<T = any>(
  method: string,
  params: Json = {},
  options: Pick<RequestInit, "signal" | "keepalive"> = {},
): Promise<T> {
  const requestGeneration = connectionGeneration;
  let path = "/api/agent/action";
  let verb = "POST";
  let body: Json | undefined = { action: method, ...params };
  if (method === "settings/read") {
    path = "/api/config";
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
        configurationIssue: {
          code: mutating ? "write_unconfirmed" : "read_failed",
          persistence: "unconfirmed",
          recovery: "read",
        } as ConfigurationIssue,
      },
    );
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      method: verb,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
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
    value = await response.json();
  } catch (error) {
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
    if (version === settingsVersion) acceptSettings(settings);
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
      s.thread?.runtime?.effort ||
      (model?.supportedReasoningEfforts.some(
        (e: Json) =>
          e.reasoningEffort ===
          (useConfigured ? settings.configuration?.defaults.effort : s.effort),
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
      useApp.setState({ threads, threadsLoading: false });
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
  const version = ++loadVersion;
  hydrating = id;
  buffer = [];
  bufferBytes = 0;
  bufferOverflow = false;
  let reload = false;
  useApp.setState({
    selectedId: id,
    thread:
      useApp.getState().thread?.id === id ? useApp.getState().thread : null,
    loading: true,
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
export function newChat() {
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
    selectedId: null,
    thread: null,
    error: "",
    loading: false,
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
      void loadSettings().catch(useApp.getState().notify);
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
    const capabilities = await response.json();
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
          const batch = await response.json();
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
        .then((r) => r.json())
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
  controller = undefined;
  source?.close();
  source = undefined;
  useApp.setState({
    connected: false,
    backgroundFailure: null,
    loading: false,
    olderLoading: false,
    threadsLoading: false,
    settingsLoading: false,
  });
}

export function clearPendingRun(requestId?: string) {
  if (requestId && sessionStorage.getItem("ma_pending_run_id") !== requestId)
    return;
  sessionStorage.removeItem("ma_pending_run_id");
  sessionStorage.removeItem("ma_pending_run_fingerprint");
  useApp.setState({ pendingRun: null });
}
export async function submitRun(payload: Json) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  let requestId = sessionStorage.getItem("ma_pending_run_id");
  if (
    requestId &&
    sessionStorage.getItem("ma_pending_run_fingerprint") !== fingerprint
  )
    throw new Error("上次发送尚未确认，请先检查发送状态，再发送其他消息");
  if (!requestId) {
    requestId = crypto.randomUUID();
    sessionStorage.setItem("ma_pending_run_id", requestId);
    sessionStorage.setItem("ma_pending_run_fingerprint", fingerprint);
    useApp.setState({ pendingRun: requestId });
  } else {
    const r = await fetch(`/api/agent/runs/${requestId}`);
    if (r.ok) {
      const status = await r.json();
      if (status.turn?.id) {
        clearPendingRun(requestId);
        return status;
      }
      if (["rejected", "abandoned"].includes(status.state))
        clearPendingRun(requestId);
      throw new Error("上次发送结果尚未确认。请检查发送状态，系统不会重复执行");
    }
    if (r.status !== 404) throw new Error("无法确认上次请求状态，请稍后重试");
  }
  try {
    const result = await request("turn/start", { ...payload, requestId });
    clearPendingRun(requestId);
    return result;
  } catch (error) {
    try {
      const status = await fetch(`/api/agent/runs/${requestId}`);
      if (
        (status.ok &&
          ["rejected", "abandoned"].includes((await status.json()).state)) ||
        (status.status === 404 && typeof (error as Json).status === "number")
      )
        clearPendingRun(requestId);
    } catch {
      /* Keep the stable request ID when the outcome cannot be confirmed. */
    }
    throw error;
  }
}
