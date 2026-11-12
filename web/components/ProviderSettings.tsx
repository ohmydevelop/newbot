import ConfigurationFeedback, {
  useConfigurationRecovery,
  savedReadFailure,
} from "./ConfigurationFeedback";
import { useState, useEffect } from "react";
import { Plus, RefreshCw, Pencil, CloudDownload, Trash2 } from "lucide-react";
import type {
  ConfigurationView,
  DefaultsSaveResult,
} from "../../shared/configuration";
import GatewayEditor from "./GatewayEditor";
import { useApp, loadSettings, request } from "../store";
type Draft = { id: string; revision: string };
export default function ProviderSettings() {
  const settings = useApp((s) => s.settings);
  const [catalog, setCatalog] = useState<
    Record<
      string,
      {
        defaultModel: string;
        defaultRevision: string;
        profileError?: string;
        models: { model: string; displayName: string; source?: string }[];
        error?: string;
      }
    >
  >({});
  const [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    let live = true;
    void request<import("../../shared/types").Json[]>("gateway/catalog")
      .then((list) => {
        if (live) setCatalog(Object.fromEntries(list.map((g) => [g.id, g])));
      })
      .catch(() => {
        if (live) setCatalogError("模型目录读取失败，请刷新重试");
      });
    return () => {
      live = false;
    };
  }, [JSON.stringify(settings?.configuration?.providers.map((p: {id:string}) => [p.id, settings?.configuration?.revisions?.[`provider:${p.id}`]]))]);
  const config = settings?.configuration as ConfigurationView | null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<{
    id: string;
    revision: string;
  } | null>(null);
  const recovery = useConfigurationRecovery();
  const [busyState, setBusy] = useState("");
  const busy = busyState || (recovery.busy ? "recovery" : "");
  const [notice, setNotice] = useState("");
  const providers: {
    id: string;
    current: boolean;
    summary?: ConfigurationView["providers"][number];
  }[] = (settings?.providers || [])
    .map((p: { id: string; current: boolean }) => ({
      ...p,
      summary:
        config?.providers.find((v) => v.id === p.id) ||
        (p.current
          ? {
              id: p.id,
              name: p.id === "openai" ? "OpenAI" : p.id,
              editable: false,
              requiresAccountAuth: true,
              endpointOrigin: null,
              wireApi: null,
              credentials: "none" as const,
            }
          : undefined),
    }))
    .filter(
      (p: { summary?: unknown; current: boolean }) => !!p.summary || p.current,
    )
    .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
  async function action(key: string, fn: () => Promise<void>) {
    setBusy(key);
    recovery.clear();
    setNotice("");
    try {
      await fn();
    } catch (e) {
      recovery.capture(
        e,
        draft?.revision || deleting?.revision || config?.revision,
      );
    } finally {
      setBusy("");
    }
  }
  async function refresh() {
    await loadSettings();
    if (!useApp.getState().settings?.configuration)
      throw new Error("配置暂不可读，请恢复连接后重新读取");
    const entries = await request<import("../../shared/types").Json[]>(
      "gateway/catalog",
      { refresh: true },
    );
    setCatalog(Object.fromEntries(entries.map((g) => [g.id, g])));
    setCatalogError("");
  }
  async function saveGatewayDefault(data: object) {
    const result = await request<DefaultsSaveResult>("gateway/defaults", data);
    useApp.setState(s => ({settings:s.settings ? {...s.settings, configuration:result.configuration, providers:s.settings.providers.map((p: {id:string})=>({...p,current:p.id===result.configuration.defaults.provider}))}:s.settings}));
    const selected = data as {id:string;model:string};
    setCatalog(previous => Object.fromEntries(Object.entries(previous).map(([id, entry]) => [id, {...entry,
      ...(id===selected.id ? {defaultModel:selected.model} : {}),
      defaultRevision:result.configuration.revisions?.[`gateway-default:${id}`] || entry.defaultRevision,
    }])));
    if (result.state === "overridden")
      recovery.report(
        "配置已保存，但全局默认值受其他配置或管理策略覆盖。",
        { code: "overridden", persistence: "saved", recovery: "read" },
        config?.revision,
      );
    else setNotice("默认模型已保存。");
  }
  async function changed(method: string, data: object) {
    const saved = await request<DefaultsSaveResult>(method, data);
    useApp.setState((s) => ({
      settings: s.settings
        ? { ...s.settings, configuration: saved.configuration }
        : null,
    }));
    setDraft(null);
    setDeleting(null);

    if (saved.state === "overridden")
      recovery.report(
        "已写入用户配置，生效值受其他配置覆盖，请检查来源。",
        { code: "overridden", persistence: "saved", recovery: "read" },
        draft?.revision || config?.revision,
      );
    setNotice(saved.state === "overridden" ? "" : "已保存。");
  }
  function edit(id?: string) {
    if (!config) return;
    recovery.clear();
    setNotice("");
    setDeleting(null);
    setDraft({
      id: id || "",
      revision: id ? config.revisions?.[`provider:${id}`] || config.revision : config.revision,
    });
  }
  const feedback = (
    <ConfigurationFeedback
      recovery={recovery}
      showAvailability={false}
      scope="provider"
      target={draft?.id || deleting?.id}
      hasDraft={!!draft}
      busy={!!busyState}
      onAdopt={() => {
        setDraft(null);
        setDeleting(null);
        recovery.clear();
        setNotice("已采用当前生效配置，可以重新编辑。");
      }}
    />
  );
  return (
    <section className="provider-settings" aria-label="网关管理">
      <div className="section-heading">
        <h3>网关</h3>
        <div className="section-actions">
          {config?.providerSourceConfigured && (
            <button
              type="button"
              className="icon-button"
              title="从配置来源刷新"
              aria-label="从配置来源刷新"
              disabled={!!busy}
              onClick={() =>
                void action("source", async () => {
                  const response = await fetch("/api/runtime/config/reload", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ expectedRevision: config.revision }),
                  });
                  if (!response.ok)
                    throw new Error("配置来源暂不可用，已保留当前参数。");
                  await refresh();
                })
              }
            >
              <CloudDownload size={18} aria-hidden="true" />
            </button>
          )}

          <button
            className="icon-button"
            aria-label="添加网关"
            title="添加网关"
            disabled={!!busy || recovery.blocked || !config?.writable}
            onClick={() => edit()}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            aria-label="刷新网关"
            title="刷新网关"
            disabled={!!busy}
            onClick={() => void action("reload", refresh)}
          >
            <RefreshCw
              size={18}
              className={busy ? "spin" : ""}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
      {config?.providerSourceStatus === "unavailable" && (
        <p className="inline-error" role="alert">
          配置来源暂不可用，可手动添加或稍后重试。
        </p>
      )}
      {config?.providerStorage === "memory" && (
        <p className="muted">当前网关仅临时保存，服务重启后需重新配置。</p>
      )}
      {config && !config.providers.some((p) => !p.missing) && (
        <p className="muted">尚未添加网关</p>
      )}
      {catalogError && (
        <p role="alert" className="inline-error">
          {catalogError}
        </p>
      )}
      <div className="gateway-grid" role="group" aria-label="选择默认网关">
        {providers.map((p) => {
          const entry = catalog[p.id],
            name = p.summary?.name || p.id;
          const disabled =
            !!busy ||
            recovery.blocked ||
            !config?.writable ||
            !!p.summary?.missing ||
            !!entry?.profileError;
          return (
            <div
              className={`gateway-card ${p.current ? "is-default" : ""}`}
              key={p.id}
            >
              <button
                type="button"
                className="gateway-select"
                aria-pressed={p.current}
                aria-label={`${name}，${p.current ? "当前默认网关" : "选择为默认网关"}`}
                disabled={disabled}
                onClick={() => {
                  if (p.current) return;
                  if (!entry?.models.some(m => m.model === entry.defaultModel)) {
                    document.getElementById(`gateway-model-${p.id}`)?.focus();
                    return;
                  }
                  void action(`default:${p.id}`, () =>
                    saveGatewayDefault({
                      id: p.id,
                      model: entry.defaultModel,
                      expectedDefaultRevision: entry.defaultRevision,
                      expectedRevision: config?.revision,
                      makeDefault: true,
                    }),
                  );
                }}
              >
                <span className="gateway-name">
                  <strong title={name}>{name}</strong>
                  <small>
                    {!entry
                      ? "正在读取模型"
                      : entry.models.length
                        ? `${entry.models.length} 个模型`
                        : entry.error
                          ? "目录暂不可用"
                          : "暂无模型"}
                  </small>
                </span>
              </button>
              <div className="gateway-actions">
                <button
                  className="icon-button"
                  type="button"
                  data-gateway-edit
                  disabled={!!busy}
                  aria-label={`编辑 ${name}`}
                  title={p.summary?.editable ? "编辑" : "查看连接"}
                  onClick={() => edit(p.id)}
                >
                  <Pencil size={16} aria-hidden="true" />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={!!busy || !p.summary?.editable}
                  data-variant="destructive"
                  aria-label={`删除 ${name}`}
                  title={
                    p.summary?.editable ? "删除网关" : "此网关由其他来源管理"
                  }
                  onClick={() => {
                    edit(p.id);
                    setDeleting({ id: p.id, revision: config!.revision });
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
              {p.summary?.missing ? (
                <span className="muted">等待恢复配置</span>
              ) : (
                <select
                  id={`gateway-model-${p.id}`}
                  aria-label={`${name} 默认模型`}
                  disabled={disabled || !entry?.models.length}
                  value={entry?.models.some(m => m.model === entry.defaultModel) ? entry.defaultModel : ""}
                  onChange={(e) => {
                    const model = e.target.value;
                    void action(`default:${p.id}`, () =>
                      saveGatewayDefault({
                        id: p.id,
                        model,
                        expectedDefaultRevision: entry?.defaultRevision,
                        expectedRevision: config?.revision,
                      }),
                    );
                  }}
                >
                  <option value="" disabled>
                    选择默认模型
                  </option>
                  {entry?.models.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.displayName}
                      {m.source === "manual" ? " · 手动" : ""}
                    </option>
                  ))}
                </select>
              )}
              {entry?.error && (
                <p className="gateway-details muted" role="status">
                  {entry.error}
                </p>
              )}
              {entry?.profileError && (
                <p className="inline-error gateway-details" role="alert">
                  {entry.profileError}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {draft && (
        <GatewayEditor
          provider={
            draft.id
              ? providers.find((p) => p.id === draft.id)?.summary
              : undefined
          }
          revision={draft.revision}
          onClose={() => {
            setDraft(null);
            recovery.clear();
          }}
          onSaved={loadSettings}
        >
          {draft.id &&
            (() => {
              const p = providers.find((p) => p.id === draft.id)?.summary;
              return (
                <>
                  {deleting && (
                    <div role="group" aria-label="确认删除网关">
                      <p>
                        删除后无法从此处恢复。历史会话仍在使用的网关不能删除。
                      </p>
                      <button
                        type="button"
                        className="secondary danger-text"
                        onClick={() =>
                          void action("delete", () =>
                            changed("provider/delete", {
                              id: deleting.id,
                              expectedRevision: deleting.revision,
                            }),
                          )
                        }
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setDeleting(null)}
                      >
                        保留
                      </button>
                    </div>
                  )}
                  {feedback}
                </>
              );
            })()}
        </GatewayEditor>
      )}
      <span className="sr-only" role="status">
        {busy ? "正在处理网关配置" : notice}
      </span>
      {!draft && feedback}
    </section>
  );
}
