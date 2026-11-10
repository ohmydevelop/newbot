import ConfigurationFeedback, {
  useConfigurationRecovery,
  savedReadFailure,
} from "./ConfigurationFeedback";
import { useState, useEffect, lazy } from "react";
import { Plus, RefreshCw, Pencil } from "lucide-react";
import type {
  ConfigurationView,
  DefaultsSaveResult,
} from "../../shared/configuration";
import GatewayEditor from "./GatewayEditor";
import CatalogIcon from "./CatalogIcon";
import { DeferredPanel } from "./DeferredPanel";
import { useApp, loadSettings, request } from "../store";
type Draft = { id: string; revision: string };
const CredentialProbe = lazy(() => import("./CredentialProbe"));
type Diagnostic = { source: string; models: string[]; note: string };
export default function ProviderSettings() {
  const settings = useApp((s) => s.settings);
  const canProbe = useApp((s) => s.credentialProbe);
  const [catalog, setCatalog] = useState<
    Record<
      string,
      {
        defaultModel: string;
        defaultRevision: string;
        profileError?: string;
        models: { model: string; displayName: string }[];
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
  }, [settings]);
  const config = settings?.configuration as ConfigurationView | null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<{
    id: string;
    revision: string;
  } | null>(null);
  const [probe, setProbe] = useState<{ id: string; model: string } | null>(
    null,
  );
  const [result, setResult] = useState<Diagnostic | null>(null);
  const recovery = useConfigurationRecovery();
  const [busyState, setBusy] = useState("");
  const busy = busyState || (recovery.busy ? "recovery" : "");
  const [notice, setNotice] = useState("");
  const [privateProbe, setPrivateProbe] = useState<{
    id: string;
    revision: string;
  } | null>(null);
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
    );
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
    await refresh();
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
    setResult(null);
    try {
      await refresh();
    } catch {
      throw savedReadFailure("配置已写入，但刷新失败，请重新读取确认当前状态");
    }
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
    setProbe(null);
    setResult(null);
    setDraft({
      id: id || "",
      revision: config.revision,
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
        setProbe(null);
        setResult(null);
        recovery.clear();
        setNotice("已采用当前生效配置，可以重新编辑。");
      }}
    />
  );
  return (
    <section className="provider-settings" aria-label="模型网关管理">
      <div className="section-heading">
        <h3>模型网关</h3>
        <div className="section-actions">
          <button
            className="icon-button"
            aria-label="添加模型网关"
            title="添加模型网关"
            disabled={!!busy || recovery.blocked || !config?.writable}
            onClick={() => edit()}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            aria-label="刷新模型网关"
            title="刷新模型网关"
            disabled={!!busy}
            onClick={() => void action("reload", refresh)}
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      {(config?.providerStorage === "memory" ||
        config?.providerStorage === "sqlite") && (
        <p className="muted" role="status">
          {config.providerSourceStatus === "unavailable"
            ? "配置来源暂不可用，当前没有已保存的网关配置。可手动添加或稍后重试。"
            : !config.providers.some((p) => !p.missing)
              ? "尚未配置自定义网关。添加后自动保存，服务重启时恢复。"
              : config.providerStorage === "sqlite"
                ? "网关参数已保存到 SQLite，修改从下一轮生效；服务重启后自动恢复。"
                : "网关参数仅保存在服务端内存，修改从下一轮生效；后端重启后需重新下发。"}
          {config.providerSourceConfigured && (
            <button
              type="button"
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                void action("source", async () => {
                  await fetch("/api/runtime/config/reload", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ expectedRevision: config.revision }),
                  }).then(async (r) => {
                    if (!r.ok)
                      throw new Error("配置来源暂不可用，已保留当前参数。");
                  });
                  await refresh();
                })
              }
            >
              重新下发
            </button>
          )}
        </p>
      )}
      {catalogError && (
        <p role="alert" className="inline-error">
          {catalogError}
        </p>
      )}
      {providers.map((p: (typeof providers)[number]) => (
        <div className="provider-row gateway-row" key={p.id}>
          <div className="gateway-name">
            <CatalogIcon name={p.summary?.name || p.id} kind="gateway" />
            <strong>{p.summary?.name || p.id}</strong>
          </div>
          {p.summary?.missing ? (
            <span className="muted">等待恢复配置</span>
          ) : (
            <select
              aria-label={`${p.summary?.name || p.id} 默认模型`}
              disabled={
                !!busy ||
                !catalog[p.id]?.models.length ||
                !!catalog[p.id]?.profileError ||
                !config?.writable
              }
              value={catalog[p.id]?.defaultModel || ""}
              onChange={(e) =>
                void action(`default:${p.id}`, async () => {
                  await saveGatewayDefault({
                    id: p.id,
                    model: e.target.value,
                    expectedDefaultRevision: catalog[p.id]?.defaultRevision,
                    expectedRevision: config?.revision,
                  });
                })
              }
            >
              <option value="" disabled>
                选择模型
              </option>
              {catalog[p.id]?.models.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.displayName}
                </option>
              ))}
            </select>
          )}
          {p.current ? (
            <span className="gateway-default" aria-label="当前默认网关">
              默认
            </span>
          ) : (
            <button
              className="secondary gateway-default"
              disabled={
                !!busy ||
                !catalog[p.id]?.defaultModel ||
                !!catalog[p.id]?.profileError ||
                !config?.writable
              }
              onClick={() =>
                void action(`default:${p.id}`, async () => {
                  await saveGatewayDefault({
                    id: p.id,
                    model: catalog[p.id]?.defaultModel,
                    expectedDefaultRevision: catalog[p.id]?.defaultRevision,
                    expectedRevision: config?.revision,
                    makeDefault: true,
                  });
                })
              }
            >
              设为默认
            </button>
          )}
          <button
            className="icon-button"
            disabled={!!busy}
            aria-label={`编辑 ${p.summary?.name || p.id}`}
            data-gateway-edit
            title={
              p.summary?.missing
                ? "恢复原会话的网关配置"
                : !p.summary?.editable
                  ? "此网关由其他配置来源管理"
                  : "编辑"
            }
            onClick={() => edit(p.id)}
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
          {catalog[p.id]?.profileError && (
            <p className="inline-error gateway-details" role="alert">
              {catalog[p.id].profileError}
            </p>
          )}
        </div>
      ))}
      {draft && (
        <GatewayEditor
          provider={
            draft.id
              ? providers.find((p) => p.id === draft.id)?.summary
              : undefined
          }
          revision={draft.revision}
          onProbe={(() => {
            const provider = providers.find((p) => p.id === draft.id)?.summary;
            return canProbe &&
              provider?.endpointOrigin?.startsWith("https://") &&
              !provider.requiresAccountAuth &&
              provider.wireApi === "responses"
              ? () =>
                  setPrivateProbe({ id: draft.id, revision: draft.revision })
              : undefined;
          })()}
          onClose={() => {
            setPrivateProbe(null);
            setDraft(null);
            recovery.clear();
          }}
          onSaved={refresh}
        >
          {draft.id &&
            (() => {
              const p = providers.find((p) => p.id === draft.id)?.summary;
              return (
                <>
                  <div className="provider-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => {
                        setProbe({
                          id: draft.id,
                          model: settings?.model || "",
                        });
                      }}
                    >
                      检查连接
                    </button>
                    {p?.editable && (
                      <button
                        type="button"
                        className="secondary danger-text"
                        disabled={!!busy}
                        onClick={() => {
                          setDeleting({
                            id: draft.id,
                            revision: config!.revision,
                          });
                        }}
                      >
                        删除
                      </button>
                    )}
                  </div>
                  {probe && (
                    <div className="provider-diagnostic">
                      <label className="field-label">
                        测试模型
                        <input
                          value={probe.model}
                          onChange={(e) =>
                            setProbe({ ...probe, model: e.target.value })
                          }
                        />
                      </label>
                      <div className="provider-actions">
                        <button
                          type="button"
                          className="secondary"
                          disabled={!!busy}
                          onClick={() =>
                            void action("models", async () => {
                              setResult(
                                await request("provider/models", {
                                  id: probe.id,
                                  expectedRevision: config?.revision,
                                }),
                              );
                            })
                          }
                        >
                          读取模型
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!!busy || !probe.model}
                          onClick={() =>
                            void action("test", async () => {
                              setResult(
                                await request("provider/test", {
                                  id: probe.id,
                                  expectedRevision: config?.revision,
                                  model: probe.model,
                                }),
                              );
                            })
                          }
                        >
                          测试连接
                        </button>
                      </div>
                      <p className="muted">
                        测试连接会发送少量固定文本，可能产生模型费用。
                      </p>
                      {result && (
                        <p role="status">
                          {result.note}
                          {result.models.join("、")}
                        </p>
                      )}
                    </div>
                  )}
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
      {busy && (
        <p className="muted" role="status">
          正在处理网关配置…
        </p>
      )}
      {privateProbe && (
        <DeferredPanel
          label="私密凭证验证"
          onClose={() => setPrivateProbe(null)}
        >
          <CredentialProbe
            providerId={privateProbe.id}
            revision={privateProbe.revision}
            onClose={() => setPrivateProbe(null)}
          />
        </DeferredPanel>
      )}
      {!draft && feedback}

      {notice && (
        <p className="configuration-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
