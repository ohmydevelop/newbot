import { useOperationScope } from "../use-operation-scope";
import { readCurrentConfiguration } from "../configuration-read";
import type { Operation } from "../operation-scope";
import ConfigurationFeedback, {
  useConfigurationRecovery,
} from "./ConfigurationFeedback";
import { useState, useEffect, useContext } from "react";
import { Check, Pencil, CloudDownload, Trash2 } from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { GatewayIcon } from "./AppIcons";
import { MoreIcon } from "./ReferenceIcons";
import { CatalogToolbar } from "./CatalogToolbar";
import { CatalogRefreshButton } from "./CatalogRefreshButton";
import { CatalogCopy } from "./CatalogCopy";
import { CatalogFilter } from "./CatalogFilter";
import { CatalogNavigation } from "./CatalogNavigation";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import { useCatalogField } from "../catalog-state";
import type {
  ConfigurationView,
  DefaultsSaveResult,
} from "../../shared/configuration";
import GatewayEditor from "./GatewayEditor";
import { useApp, loadSettings, request } from "../store";
type Draft = { id: string; revision: string };
export default function ProviderSettings() {
  const settings = useApp((s) => s.settings);
  const [query, setQuery] = useCatalogField("models", "query");
  const navigation = useContext(CatalogNavigation);
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
  const scope = useOperationScope();
  const providerRevision = () =>
    JSON.stringify(
      useApp
        .getState()
        .settings?.configuration?.providers.map((p: { id: string }) => [
          p.id,
          useApp.getState().settings?.configuration?.revisions?.[
            `provider:${p.id}`
          ],
        ]),
    );
  async function readCatalog(task: Operation, refresh = false) {
    const entries = await readCurrentConfiguration(
      providerRevision,
      () =>
        request<import("../../shared/types").Json[]>(
          "gateway/catalog",
          { refresh },
          { signal: task.signal },
        ),
      task.isCurrent,
    );
    if (entries && task.isCurrent()) {
      setCatalog(Object.fromEntries(entries.map((g) => [g.id, g])));
      setCatalogError("");
    }
  }
  useEffect(() => {
    const task = scope.start("read", "catalog");
    if (!task) return;
    void readCatalog(task)
      .catch(() => {
        if (task.isCurrent()) setCatalogError("模型目录读取失败，请刷新重试");
      })
      .finally(task.finish);
  }, [providerRevision()]);
  const config = settings?.configuration as ConfigurationView | null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<{
    id: string;
    revision: string;
  } | null>(null);
  const recovery = useConfigurationRecovery();
  const busyState = scope.busy;
  const [editorBusy, setEditorBusy] = useState(false);
  const busy =
    busyState || (editorBusy ? "editor" : recovery.busy ? "recovery" : "");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (busyState && busyState !== "catalog") return navigation?.lock();
  }, [busyState, navigation?.lock]);
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
  async function action(key: string, fn: (task: Operation) => Promise<void>) {
    if (editorBusy || recovery.busy) return;
    const task = scope.start("write", key);
    if (!task) return;
    recovery.clear();
    setNotice("");
    try {
      await fn(task);
    } catch (e) {
      if (!task.isCurrent()) return;
      recovery.capture(
        e,
        draft?.revision || deleting?.revision || config?.revision,
      );
    } finally {
      task.finish();
    }
  }
  async function refresh(task: Operation) {
    await loadSettings();
    if (!task.isCurrent()) return;
    if (!useApp.getState().settings?.configuration)
      throw new Error("配置暂不可读，请恢复连接后重新读取");
    await readCatalog(task, true);
  }
  async function saveGatewayDefault(data: object, task: Operation) {
    const result = await request<DefaultsSaveResult>("gateway/defaults", data);
    if (!task.isCurrent()) return;
    useApp.setState((s) => ({
      settings: s.settings
        ? {
            ...s.settings,
            configuration: result.configuration,
            providers: s.settings.providers.map((p: { id: string }) => ({
              ...p,
              current: p.id === result.configuration.defaults.provider,
            })),
          }
        : s.settings,
    }));
    const selected = data as { id: string; model: string };
    setCatalog((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([id, entry]) => [
          id,
          {
            ...entry,
            ...(id === selected.id ? { defaultModel: selected.model } : {}),
            defaultRevision:
              result.configuration.revisions?.[`gateway-default:${id}`] ||
              entry.defaultRevision,
          },
        ]),
      ),
    );
    if (result.state === "overridden")
      recovery.report(
        "配置已保存，但全局默认值受其他配置或管理策略覆盖。",
        { code: "overridden", persistence: "saved", recovery: "read" },
        config?.revision,
      );
    else setNotice("默认模型已保存。");
  }
  async function changed(method: string, data: object, task: Operation) {
    const saved = await request<DefaultsSaveResult>(method, data);
    if (!task.isCurrent()) return;
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
      revision: id
        ? config.revisions?.[`provider:${id}`] || config.revision
        : config.revision,
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
  const matches = providers.filter((p) => {
    const entry = catalog[p.id];
    return [
      p.id,
      p.summary?.name,
      ...(entry?.models.flatMap((m) => [m.model, m.displayName]) || []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  });
  async function makeDefault(id: string) {
    const entry = catalog[id];
    if (!entry?.models.some((model) => model.model === entry.defaultModel)) {
      edit(id);
      return;
    }
    await action(`default:${id}`, (task) =>
      saveGatewayDefault(
        {
          id,
          model: entry.defaultModel,
          expectedDefaultRevision: entry.defaultRevision,
          expectedRevision: config?.revision,
          makeDefault: true,
        },
        task,
      ),
    );
  }
  return (
    <section className="provider-settings" aria-label="模型管理">
      <CatalogToolbar label="模型" query={query} onQuery={setQuery}>
        {config?.providerSourceConfigured && (
          <button
            type="button"
            className="icon-button"
            title="从配置来源刷新"
            aria-label="从配置来源刷新"
            disabled={!!busy}
            onClick={() =>
              void action("source", async (task) => {
                const response = await fetch("/api/runtime/config/reload", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ expectedRevision: config.revision }),
                });
                if (!response.ok)
                  throw new Error("配置来源暂不可用，已保留当前参数。");
                await refresh(task);
              })
            }
          >
            <CloudDownload size={18} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="primary catalog-add"
          aria-label="添加模型连接"
          disabled={!!busy || recovery.blocked || !config?.writable}
          onClick={() => edit()}
        >
          添加连接
        </button>
        <CatalogRefreshButton
          label="刷新模型"
          busy={!!busy}
          onClick={() => void action("reload", refresh)}
        />
      </CatalogToolbar>
      {config?.providerSourceStatus === "unavailable" && (
        <p className="inline-error" role="alert">
          配置来源暂不可用，可手动添加或稍后重试。
        </p>
      )}
      {config?.providerStorage === "memory" && (
        <p className="muted">当前连接仅临时保存，重启后需重新配置。</p>
      )}
      {catalogError && (
        <p role="alert" className="inline-error">
          {catalogError}
        </p>
      )}
      {!matches.length && (
        <div className="extension-empty">
          <GatewayIcon size={24} aria-hidden="true" />
          <p>{query ? "没有匹配的模型或连接" : "尚未添加连接"}</p>
        </div>
      )}
      <div className="catalog-grid" aria-label="模型连接">
        {matches.map((p) => {
          const entry = catalog[p.id],
            name = p.summary?.name || p.id;
          return (
            <div className="catalog-entry model-entry" key={p.id}>
              <button
                type="button"
                className="catalog-entry-main"
                aria-label={`查看模型连接 ${name}`}
                disabled={!!busy}
                onClick={() => edit(p.id)}
              >
                <span className="expert-icon">
                  <GatewayIcon size={22} aria-hidden="true" />
                </span>
                <CatalogCopy
                  name={name}
                  description={
                    p.summary?.missing
                      ? "等待恢复配置"
                      : entry
                        ? entry.models.length
                          ? `${entry.defaultModel || "未选默认模型"} · ${entry.models.length} 个模型`
                          : entry.error
                            ? "目录暂不可用"
                            : "暂无模型"
                        : "正在读取模型"
                  }
                  status={
                    p.current ? (
                      <>
                        <Check size={14} aria-hidden="true" />
                        默认
                      </>
                    ) : undefined
                  }
                />
              </button>
              <Dropdown.Root>
                <Dropdown.Trigger
                  className="icon-button catalog-more"
                  aria-label={`${name} 更多操作`}
                  disabled={!!busy}
                >
                  <MoreIcon size={18} aria-hidden="true" />
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <ActionMenuContent>
                    <ActionMenuItem icon={Pencil} onSelect={() => edit(p.id)}>
                      配置连接
                    </ActionMenuItem>
                    <ActionMenuItem
                      icon={Check}
                      disabled={
                        p.current ||
                        !config?.writable ||
                        recovery.blocked ||
                        !!p.summary?.missing ||
                        !!entry?.profileError
                      }
                      onSelect={() => void makeDefault(p.id)}
                    >
                      设为默认
                    </ActionMenuItem>
                    <ActionMenuItem
                      icon={Trash2}
                      destructive
                      disabled={!p.summary?.editable}
                      onSelect={() => {
                        edit(p.id);
                        setDeleting({ id: p.id, revision: config!.revision });
                      }}
                    >
                      移除连接
                    </ActionMenuItem>
                  </ActionMenuContent>
                </Dropdown.Portal>
              </Dropdown.Root>
              {entry?.error && (
                <p className="inline-error model-entry-error" role="status">
                  {entry.error}
                </p>
              )}
              {entry?.profileError && (
                <p className="inline-error model-entry-error" role="alert">
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
          blocked={!!busyState || !!recovery.busy}
          onBusyChange={setEditorBusy}
        >
          {draft.id &&
            (() => {
              const p = providers.find((p) => p.id === draft.id)?.summary;
              return (
                <>
                  {!deleting && (
                    <div className="model-default-control">
                      <span>默认模型</span>
                      <CatalogFilter
                        label={`${p?.name || draft.id} 默认模型`}
                        id={`gateway-model-${draft.id}`}
                        value={catalog[draft.id]?.defaultModel || ""}
                        placeholder="选择默认模型"
                        disabled={
                          !!busy ||
                          recovery.blocked ||
                          !config?.writable ||
                          !!p?.missing ||
                          !!catalog[draft.id]?.profileError ||
                          !catalog[draft.id]?.models.length
                        }
                        options={(catalog[draft.id]?.models || []).map((m) => ({
                          value: m.model,
                          label:
                            m.displayName +
                            (m.source === "manual" ? " · 手动" : ""),
                        }))}
                        onValueChange={(model) =>
                          void action(`default:${draft.id}`, (task) =>
                            saveGatewayDefault(
                              {
                                id: draft.id,
                                model,
                                expectedDefaultRevision:
                                  catalog[draft.id]?.defaultRevision,
                                expectedRevision: config?.revision,
                              },
                              task,
                            ),
                          )
                        }
                      />
                      {!providers.find((provider) => provider.id === draft.id)
                        ?.current && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            !!busy ||
                            !config?.writable ||
                            recovery.blocked ||
                            !!p?.missing ||
                            !!catalog[draft.id]?.profileError ||
                            !catalog[draft.id]?.models.some(
                              (model) =>
                                model.model === catalog[draft.id]?.defaultModel,
                            )
                          }
                          onClick={() => void makeDefault(draft.id)}
                        >
                          设为默认连接
                        </button>
                      )}
                    </div>
                  )}
                  {deleting && (
                    <div role="group" aria-label="确认移除连接">
                      <p>
                        删除后无法从此处恢复。历史会话仍在使用的连接不能移除。
                      </p>
                      <button
                        type="button"
                        className="secondary danger-text"
                        disabled={!!busy}
                        onClick={() =>
                          void action("delete", (task) =>
                            changed(
                              "provider/delete",
                              {
                                id: deleting.id,
                                expectedRevision: deleting.revision,
                              },
                              task,
                            ),
                          )
                        }
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!busy}
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
        {busy ? "正在处理模型配置" : notice}
      </span>
      {!draft && feedback}
    </section>
  );
}
