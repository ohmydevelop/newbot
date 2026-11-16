import { CatalogCopy } from "./CatalogCopy";
import { useMcpOAuthCompletion, type OAuthAttempt } from "../use-mcp-oauth";
import { connectionStateLabels as stateLabel } from "../connection-state";
import { MoreIcon as MoreHorizontal } from "./ReferenceIcons";
import ConnectorEditor from "./ConnectorEditor";
import { connectorCatalogNames } from "../connector-catalog";
import { Modal } from "./ui";
import { CatalogDetail } from "./CatalogNavigation";
import ConfigurationFeedback, {
  useConfigurationRecovery,
  savedReadFailure,
} from "./ConfigurationFeedback";
import { useState, useEffect } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Info,
  Power,
  PowerOff,
  CircleCheck,
  CircleDashed,
  CircleAlert,
  Ban,
  Wrench,
} from "lucide-react";
import CatalogIcon from "./CatalogIcon";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import {
  Plus,
  RefreshCw,
  LoaderCircle,
  Pencil,
  Trash2,
  KeyRound,
} from "lucide-react";
import { useApp, loadSettings, loadDiscovery, request } from "../store";
import type {
  ConfigurationView,
  DefaultsSaveResult,
} from "../../shared/configuration";
type Draft = {
  id: string;
  create: boolean;
  revision: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  envRefs: string;
  clearEnv: boolean;
  url: string;
  bearerEnv: string;
  clearBearer: boolean;
  enabled: boolean;
  startup: string;
  timeout: string;
};
function ConnectionState({ state }: { state: string }) {
  const label = stateLabel[state] || "已发现，尚未验证连接";
  const Icon =
    state === "connected"
      ? CircleCheck
      : state === "starting"
        ? LoaderCircle
        : ["failed", "authenticationRequired"].includes(state)
          ? CircleAlert
          : state === "disabled"
            ? Ban
            : CircleDashed;
  return (
    <span
      className={`connection-state ${state}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon
        size={16}
        className={state === "starting" ? "spin" : ""}
        aria-hidden="true"
      />
    </span>
  );
}
export default function McpSettings({
  embedded = false,
  query = "",
  onlyNames,
  createSignal = 0,
}: {
  embedded?: boolean;
  query?: string;
  onlyNames?: string[];
  createSignal?: number;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    if (createSignal) edit();
  }, [createSignal]);
  const settings = useApp((s) => s.settings),
    config = settings?.configuration as ConfigurationView | null;
  const [draft, setDraft] = useState<Draft | null>(null),
    [deleting, setDeleting] = useState<{ id: string; revision: string } | null>(
      null,
    ),
    [busyState, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [diagnostic, setDiagnostic] = useState<{
      id: string;
      note: string;
      toolCount: number;
      state: string;
    } | null>(null),
    [oauth, setOauth] = useState<OAuthAttempt | null>(null);
  useMcpOAuthCompletion(oauth, (success, id) => {
    setOauth(null);
    setDiagnostic({
      id,
      note: success ? "账号授权已完成。" : "账号授权未完成，请重试。",
      toolCount: 0,
      state: success ? "authorized" : "failed",
    });
  });
  const recovery = useConfigurationRecovery();
  const busy = busyState || (recovery.busy ? "recovery" : "");
  const names = connectorCatalogNames(config?.mcp, onlyNames);
  const summary = (id: string) => config?.mcp.find((m) => m.id === id);
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
      throw new Error("MCP 配置暂不可读，请恢复连接后重新读取");
  }
  async function changed(method: string, data: object) {
    const result = await request<DefaultsSaveResult>(method, data);
    useApp.setState((s) => ({
      settings: s.settings
        ? { ...s.settings, configuration: result.configuration }
        : null,
    }));
    setDraft(null);
    setDeleting(null);
    if (method === "mcp/delete") setDetailId(null);
    setDiagnostic(null);

    if (result.state === "overridden")
      recovery.report(
        "已写入用户配置，生效值受其他配置覆盖，请检查来源。",
        { code: "overridden", persistence: "saved", recovery: "read" },
        draft?.revision || config?.revision,
      );
    setNotice(result.state === "overridden" ? "" : "已保存。");
  }
  function edit(id?: string) {
    if (!config) return;
    const s = id ? summary(id) : null;
    recovery.clear();
    setNotice("");
    setDeleting(null);
    setDiagnostic(null);
    setDraft({
      id: id || "",
      create: !id,
      revision: config.revision,
      transport: s?.transport === "http" ? "http" : "stdio",
      command: "",
      args: "",
      envRefs: "",
      clearEnv: false,
      url: "",
      bearerEnv: "",
      clearBearer: false,
      enabled: s?.enabled ?? true,
      startup: s?.startupTimeout?.toString() || (id ? "" : "10"),
      timeout: s?.toolTimeout?.toString() || (id ? "" : "60"),
    });
  }
  const feedback = (
    <ConfigurationFeedback
      recovery={recovery}
      scope="mcp"
      target={draft?.id || deleting?.id}
      hasDraft={!!draft}
      busy={!!busyState}
      onAdopt={() => {
        setDraft(null);
        setDeleting(null);
        setDiagnostic(null);
        recovery.clear();
        setNotice("已采用当前生效配置，可以重新编辑。");
      }}
    />
  );
  return (
    <section
      className="provider-settings mcp-settings catalog-grid"
      aria-label="连接器管理"
    >
      {!embedded && (
        <div className="section-heading">
          <h3>连接器</h3>
          <button
            className="icon-button"
            aria-label="添加连接器"
            title="添加连接器"
            disabled={
              !!busy ||
              recovery.blocked ||
              !(config?.nativeWritable ?? config?.writable)
            }
            onClick={() => edit()}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {names.length === 0 && !!config && !embedded && (
        <p className="muted">尚未添加连接器。</p>
      )}
      {names
        .filter((id) =>
          `${summary(id)?.name || ""} ${id}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .map((id) => {
          const s = summary(id),
            native = settings?.mcp.find((m: { name: string }) => m.name === id),
            displayName = s?.name || id;
          return (
            <div className="connection-entry" key={id}>
              <div className="catalog-entry">
                <button
                  type="button"
                  className="catalog-entry-main"
                  aria-label={`查看 ${displayName}`}
                  onClick={() => setDetailId(id)}
                >
                  <CatalogIcon name={displayName} kind="connection" />
                  <CatalogCopy
                    name={displayName}
                    description={native?.serverInfo?.description}
                    status={
                      <>
                        <ConnectionState
                          state={
                            s?.enabled === false
                              ? "disabled"
                              : native?.runtimeStatus || "discovered"
                          }
                        />
                        {s?.enabled === false
                          ? "已停用"
                          : stateLabel[native?.runtimeStatus || ""] || "已添加"}
                      </>
                    }
                  />
                </button>
                <Dropdown.Root>
                  <Dropdown.Trigger
                    className="icon-button catalog-more"
                    aria-label={`${displayName} 更多操作`}
                    title="更多操作"
                  >
                    <MoreHorizontal size={20} />
                  </Dropdown.Trigger>
                  <Dropdown.Portal>
                    <ActionMenuContent
                      className="dropdown"
                      sideOffset={5}
                      align="end"
                    >
                      <ActionMenuItem
                        icon={Info}
                        onSelect={() => setDetailId(id)}
                      >
                        查看
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={RefreshCw}
                        disabled={!!busy}
                        onSelect={() =>
                          void action("reload", async () => {
                            await request("mcp/reload", {
                              expectedRevision:
                                config?.revisions?.[`mcp:${id}`] ||
                                config?.revision,
                            });
                            await refresh();
                          })
                        }
                      >
                        重连
                      </ActionMenuItem>
                      {s?.editable && (
                        <ActionMenuItem
                          icon={Pencil}
                          disabled={!!busy}
                          onSelect={() => edit(id)}
                        >
                          编辑
                        </ActionMenuItem>
                      )}
                      {s?.editable && (
                        <ActionMenuItem
                          icon={s.enabled ? PowerOff : Power}
                          disabled={!!busy}
                          onSelect={() =>
                            void action(`toggle:${id}`, () =>
                              changed("mcp/enabled", {
                                id,
                                expectedRevision:
                                  config?.revisions?.[`mcp:${id}`] ||
                                  config?.revision,
                                enabled: !s.enabled,
                              }),
                            )
                          }
                        >
                          {s.enabled ? "停用" : "启用"}
                        </ActionMenuItem>
                      )}
                      {s?.editable && (
                        <ActionMenuItem
                          icon={Trash2}
                          destructive
                          separated
                          disabled={!!busy}
                          onSelect={() =>
                            setDeleting({ id, revision: config!.revision })
                          }
                        >
                          删除
                        </ActionMenuItem>
                      )}
                    </ActionMenuContent>
                  </Dropdown.Portal>
                </Dropdown.Root>
              </div>
              {detailId === id && (
                <CatalogDetail
                  open
                  title={s?.name || id}
                  onOpenChange={(open) => {
                    if (!open) setDetailId(null);
                  }}
                  wide
                  className="connection-detail-modal"
                  dismissible={!busy}
                >
                  <div className="provider-row mcp-row">
                    {!draft && !deleting && feedback}
                    {notice && (
                      <p className="configuration-notice" role="status">
                        {notice}
                      </p>
                    )}
                    <div className="connection-meta">
                      <ConnectionState
                        state={
                          s?.enabled === false
                            ? "disabled"
                            : native?.runtimeStatus || "discovered"
                        }
                      />
                      <span>{s?.transport || "插件"}</span>
                      {s?.endpointOrigin && <span>{s.endpointOrigin}</span>}
                    </div>
                    {native?.toolsError && (
                      <p className="inline-error" role="alert">
                        {native.toolsError}
                      </p>
                    )}
                    <section className="connection-tools" aria-label="工具目录">
                      <h3>
                        工具 <span>{native?.toolCount ?? 0}</span>
                      </h3>
                      {Object.entries(native?.tools || {}).map(
                        ([name, tool]) => (
                          <div className="connection-tool" key={name}>
                            <Wrench size={16} aria-hidden="true" />
                            <div>
                              <strong>{name}</strong>
                              {(tool as { description?: string })
                                .description && (
                                <p>
                                  {
                                    (tool as { description: string })
                                      .description
                                  }
                                </p>
                              )}
                            </div>
                          </div>
                        ),
                      )}
                      {!native?.toolCount && (
                        <p className="muted">
                          {s?.enabled === false
                            ? "连接已停用"
                            : "尚未发现工具，可测试连接后刷新。"}
                        </p>
                      )}
                    </section>
                    {!s?.editable && (
                      <small className="muted">
                        {config
                          ? "此连接由插件或其他配置来源管理"
                          : "配置读取失败，请刷新后重试"}
                      </small>
                    )}
                    {s?.privateFields?.valid === false && (
                      <p className="inline-error">
                        接收方已变化，请重新设置凭证。
                      </p>
                    )}
                    <div className="provider-actions">
                      {s?.editable && (
                        <>
                          <button
                            className="secondary"
                            disabled={
                              !!busy ||
                              recovery.blocked ||
                              !(config?.nativeWritable ?? config?.writable)
                            }
                            aria-label={`编辑 ${displayName}`}
                            title="编辑"
                            onClick={() => edit(id)}
                          >
                            <Pencil size={16} aria-hidden="true" /> 编辑
                          </button>
                          <button
                            className="secondary"
                            disabled={
                              !!busy ||
                              recovery.blocked ||
                              !!draft ||
                              !!deleting ||
                              !(config?.nativeWritable ?? config?.writable)
                            }
                            aria-label={`${s.enabled ? "停用" : "启用"} ${displayName}`}
                            title={s.enabled ? "停用" : "启用"}
                            onClick={() =>
                              void action(`toggle:${id}`, () =>
                                changed("mcp/enabled", {
                                  id,
                                  expectedRevision:
                                    config?.revisions?.[`mcp:${id}`] ||
                                    config?.revision,
                                  enabled: !s.enabled,
                                }),
                              )
                            }
                          >
                            {s.enabled ? (
                              <PowerOff size={16} aria-hidden="true" />
                            ) : (
                              <Power size={16} aria-hidden="true" />
                            )}
                            {s.enabled ? "停用" : "启用"}
                          </button>
                          <button
                            className="secondary"
                            disabled={
                              !!busy ||
                              !!draft ||
                              !(config?.nativeWritable ?? config?.writable)
                            }
                            data-variant="destructive"
                            aria-label={`删除 ${displayName}`}
                            title="删除"
                            onClick={() => {
                              setDeleting({ id, revision: config!.revision });
                              recovery.clear();
                              setNotice("");
                            }}
                          >
                            <Trash2 size={16} aria-hidden="true" /> 删除
                          </button>
                        </>
                      )}
                      {s && (
                        <button
                          className="secondary"
                          disabled={
                            !!busy ||
                            recovery.blocked ||
                            !!draft ||
                            !!deleting ||
                            !config
                          }
                          aria-label={`测试 ${s?.name || id}`}
                          title="测试连接"
                          onClick={() =>
                            void action(`test:${id}`, async () => {
                              const result = await request<{
                                note: string;
                                toolCount: number;
                                state: string;
                              }>("mcp/test", {
                                id,
                                expectedRevision:
                                  config?.revisions?.[`mcp:${id}`] ||
                                  config?.revision,
                              });
                              setDiagnostic({ id, ...result });
                              await loadDiscovery("mcp");
                            })
                          }
                        >
                          <RefreshCw size={18} aria-hidden="true" /> 测试连接
                        </button>
                      )}
                      {native?.authStatus === "notLoggedIn" && (
                        <button
                          className="secondary"
                          disabled={
                            !!busy || recovery.blocked || !!draft || !!deleting
                          }
                          aria-label={`授权 ${displayName}`}
                          title="授权"
                          onClick={() =>
                            void action(`oauth:${id}`, async () => {
                              const result = await request<{
                                authorizationUrl: string;
                                loginId?: string;
                              }>("mcp/oauth", { name: id });
                              const url = new URL(result.authorizationUrl);
                              if (!["http:", "https:"].includes(url.protocol))
                                throw new Error(
                                  "授权地址不可用，请检查服务端 OAuth 配置",
                                );
                              setOauth({
                                id,
                                url: url.href,
                                loginId: result.loginId,
                              });
                            })
                          }
                        >
                          <KeyRound size={16} aria-hidden="true" /> 授权
                        </button>
                      )}
                    </div>
                    {diagnostic?.id === id && (
                      <div
                        className={
                          diagnostic.state === "failed"
                            ? "provider-diagnostic inline-error"
                            : "provider-diagnostic"
                        }
                        role="status"
                      >
                        {diagnostic.note}
                        {diagnostic.state === "discovered" &&
                          ` 共 ${diagnostic.toolCount} 个工具。`}
                      </div>
                    )}
                    {oauth?.id === id && (
                      <p className="provider-diagnostic">
                        <a
                          href={oauth.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          打开 {id} 授权页面
                        </a>
                      </p>
                    )}
                  </div>
                </CatalogDetail>
              )}
            </div>
          );
        })}
      {draft && config && (
        <ConnectorEditor
          connector={draft.create ? undefined : summary(draft.id)}
          configuration={config}
          onClose={() => {
            setDraft(null);
            recovery.clear();
          }}
          onSaved={(result) => {
            useApp.setState((s) => ({
              settings: s.settings
                ? { ...s.settings, configuration: result.configuration }
                : s.settings,
            }));
            setDraft(null);
            setNotice("已保存。");
            recovery.clear();
          }}
        />
      )}
      {deleting && (
        <Modal
          open
          title="删除连接器"
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          dismissible={!busy}
        >
          {feedback}
          <div
            className="provider-editor"
            role="group"
            aria-label="确认删除连接器"
          >
            <p>
              删除 {summary(deleting.id)?.name || deleting.id} 的用户配置？历史
              App 的后续工具交互可能不可用。
            </p>
            <div className="configuration-actions">
              <button
                className="secondary provider-delete"
                disabled={!!busy || recovery.blocked}
                onClick={() =>
                  void action("delete", () =>
                    changed("mcp/delete", {
                      id: deleting.id,
                      expectedRevision: deleting.revision,
                    }),
                  )
                }
              >
                确认删除
              </button>
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => setDeleting(null)}
              >
                保留
              </button>
            </div>
          </div>
        </Modal>
      )}
      {busy && (
        <p className="muted" role="status">
          正在处理连接配置…
        </p>
      )}
      {!draft && !detailId && !deleting && feedback}

      {notice && !detailId && (
        <p className="configuration-notice" role="status">
          {notice}
        </p>
      )}
      {!embedded && (
        <button
          className="icon-button"
          title="刷新连接器"
          aria-label="刷新连接器"
          disabled={!!busy}
          onClick={() =>
            void action("read", async () => {
              await refresh();
              await loadDiscovery("mcp");
            })
          }
        >
          <RefreshCw size={18} />
        </button>
      )}
    </section>
  );
}
