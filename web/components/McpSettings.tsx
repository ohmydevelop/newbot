import { Modal } from "./ui";
import ConfigurationFeedback, {
  useConfigurationRecovery,
  savedReadFailure,
} from "./ConfigurationFeedback";
import { useState, useEffect } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Info, Power, PowerOff } from "lucide-react";
import CatalogIcon from "./CatalogIcon";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import { Plus, RefreshCw, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import ManagedCredential from "./ManagedCredential";
import { useApp, loadSettings, request } from "../store";
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
const stateLabel: Record<string, string> = {
  notStarted: "尚未启动",
  starting: "连接中",
  connected: "已连接",
  authenticationRequired: "需要授权",
  failed: "连接失败",
  cancelled: "连接已取消",
  disabled: "已停用",
};
export default function McpSettings({
  embedded = false,
  query = "",
  excludeNames = [],
  onlyNames,
  createSignal = 0,
}: {
  embedded?: boolean;
  query?: string;
  excludeNames?: string[];
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
    [oauth, setOauth] = useState<{ id: string; url: string } | null>(null);
  const recovery = useConfigurationRecovery();
  const busy = busyState || (recovery.busy ? "recovery" : "");
  const names = [
    ...new Set<string>([
      ...(config?.mcp.map((m) => m.id) || []),
      ...(settings?.mcp || []).map((m: { name: string }) => m.name),
    ]),
  ];
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
    setDiagnostic(null);
    try {
      await refresh();
    } catch {
      throw savedReadFailure("MCP 配置已写入，但刷新失败，请重新读取确认状态");
    }
    if (result.state === "overridden")
      recovery.report(
        "已写入用户配置，生效值受其他配置覆盖，请检查来源。",
        { code: "overridden", persistence: "saved", recovery: "read" },
        draft?.revision || config?.revision,
      );
    setNotice(
      result.state === "overridden"
        ? ""
        : "已保存连接 配置并提交原生重载；连接状态请单独测试。",
    );
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
      className="provider-settings mcp-settings"
      aria-label="工具连接管理"
    >
      {!embedded && (
        <div className="section-heading">
          <h3>工具连接</h3>
          <button
            className="icon-button"
            aria-label="添加工具连接"
            title="添加工具连接"
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
        <p className="muted">尚未添加工具连接。</p>
      )}
      {names
        .filter(
          (id) =>
            !excludeNames.includes(id) &&
            (!onlyNames || onlyNames.includes(id)) &&
            id.toLowerCase().includes(query.toLowerCase()),
        )
        .map((id) => {
          const s = summary(id),
            native = settings?.mcp.find((m: { name: string }) => m.name === id);
          return (
            <div className="connection-entry" key={id}>
              <div className="catalog-entry">
                <button
                  type="button"
                  className="catalog-entry-main"
                  aria-label={`查看 ${id}`}
                  onClick={() => setDetailId(id)}
                >
                  <CatalogIcon name={id} kind="connection" />
                  <span>
                    <strong>{id}</strong>
                    <small>
                      {s?.enabled === false
                        ? "已停用"
                        : stateLabel[native?.runtimeStatus] || "工具连接"}{" "}
                      · {native?.toolCount ?? 0} 个工具
                    </small>
                  </span>
                </button>
                <Dropdown.Root>
                  <Dropdown.Trigger
                    className="icon-button catalog-more"
                    aria-label={`${id} 更多操作`}
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
                        查看详情
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={RefreshCw}
                        disabled={!!busy}
                        onSelect={() =>
                          void action("reload", async () => {
                            await request("mcp/reload", {
                              expectedRevision: config?.revision,
                            });
                            await refresh();
                          })
                        }
                      >
                        重新连接
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
                                expectedRevision: config?.revision,
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
                <Modal
                  open
                  title={id}
                  onOpenChange={(open) => {
                    if (!open) setDetailId(null);
                  }}
                  wide
                  className="connection-detail-modal"
                >
                  <div className="provider-row mcp-row">
                    <strong>{id}</strong>
                    <p className="muted">
                      {s?.transport || "插件"} ·{" "}
                      {s?.enabled === false
                        ? "已停用"
                        : stateLabel[native?.runtimeStatus] || "已发现"}{" "}
                      · {native?.toolCount ?? 0} 个工具
                    </p>
                    <details className="connection-details">
                      <summary>连接详情</summary>
                      {s?.endpointOrigin && (
                        <p className="muted">端点：{s.endpointOrigin}</p>
                      )}
                      <p className="muted">
                        {s?.editable ? "用户配置" : "由插件或其他配置来源管理"}
                        {s?.credentials ||
                        s?.hasEnvironment ||
                        s?.hasEnvReferences
                          ? " · 已有服务端凭证或环境配置"
                          : ""}
                        {s?.hasArguments ? " · 已有命令参数" : ""}
                      </p>
                      {native?.toolsError && (
                        <p className="inline-error">{native.toolsError}</p>
                      )}
                      <ManagedCredential
                        scope="mcp"
                        targetId={id}
                        revision={config?.revision || ""}
                        metadata={s?.managedCredential}
                        editable={s?.credentialEditable}
                      />
                    </details>
                    <details className="connection-tools">
                      <summary>工具目录（{native?.toolCount ?? 0}）</summary>
                      {Object.entries(native?.tools || {}).map(
                        ([name, tool]) => (
                          <div className="connection-tool" key={name}>
                            <strong>{name}</strong>
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
                    </details>
                    {!s?.editable && (
                      <small className="muted">
                        {config
                          ? "此连接由插件或其他配置来源管理"
                          : "配置读取失败，请刷新后重试"}
                      </small>
                    )}
                    <div className="provider-actions">
                      {s?.editable && (
                        <>
                          <button
                            className="icon-button"
                            disabled={
                              !!busy ||
                              recovery.blocked ||
                              !(config?.nativeWritable ?? config?.writable)
                            }
                            aria-label={`编辑 ${id}`}
                            title="编辑"
                            onClick={() => edit(id)}
                          >
                            <Pencil size={16} aria-hidden="true" />
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
                            onClick={() =>
                              void action(`toggle:${id}`, () =>
                                changed("mcp/enabled", {
                                  id,
                                  expectedRevision: config?.revision,
                                  enabled: !s.enabled,
                                }),
                              )
                            }
                          >
                            <span
                              aria-label={`${s.enabled ? "停用" : "启用"} ${id}`}
                            >
                              {s.enabled ? "停用" : "启用"}
                            </span>
                          </button>
                          <button
                            className="icon-button"
                            disabled={
                              !!busy ||
                              !!draft ||
                              !(config?.nativeWritable ?? config?.writable)
                            }
                            aria-label={`删除 ${id}`}
                            title="删除"
                            onClick={() => {
                              setDeleting({ id, revision: config!.revision });
                              recovery.clear();
                              setNotice("");
                            }}
                          >
                            <Trash2 size={16} aria-hidden="true" />
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
                          onClick={() =>
                            void action(`test:${id}`, async () => {
                              const result = await request<{
                                note: string;
                                toolCount: number;
                                state: string;
                              }>("mcp/test", {
                                id,
                                expectedRevision: config?.revision,
                              });
                              setDiagnostic({ id, ...result });
                              await refresh();
                            })
                          }
                        >
                          <span aria-label={`测试 ${id}`}>测试</span>
                        </button>
                      )}
                      {native?.authStatus === "notLoggedIn" && (
                        <button
                          className="secondary"
                          disabled={
                            !!busy || recovery.blocked || !!draft || !!deleting
                          }
                          onClick={() =>
                            void action(`oauth:${id}`, async () => {
                              const result = await request<{
                                authorizationUrl: string;
                              }>("mcp/oauth", { name: id });
                              const url = new URL(result.authorizationUrl);
                              if (!["http:", "https:"].includes(url.protocol))
                                throw new Error(
                                  "授权地址不可用，请检查服务端 OAuth 配置",
                                );
                              setOauth({ id, url: url.href });
                            })
                          }
                        >
                          <span aria-label={`授权 ${id}`}>授权</span>
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
                        ，完成后重载连接。
                      </p>
                    )}
                  </div>
                </Modal>
              )}
            </div>
          );
        })}
      {draft && (
        <Modal
          open
          title={draft.create ? "添加工具连接" : `编辑 ${draft.id}`}
          onOpenChange={(open) => {
            if (!open && !busy) {
              setDraft(null);
              recovery.clear();
            }
          }}
          dismissible={!busy}
          wide
          className="connection-editor-modal"
        >
          <form
            className="provider-editor"
            aria-label={draft.create ? "添加工具连接表单" : "编辑工具连接表单"}
            onSubmit={(e) => {
              e.preventDefault();
              void action("save", async () => {
                const patch: Record<string, unknown> = {
                  enabled: draft.enabled,
                  ...(draft.startup
                    ? { startupTimeout: Number(draft.startup) }
                    : {}),
                  ...(draft.timeout
                    ? { toolTimeout: Number(draft.timeout) }
                    : {}),
                };
                if (draft.transport === "stdio") {
                  if (draft.command) patch.command = draft.command;
                  if (draft.args.trim()) {
                    let args;
                    try {
                      args = JSON.parse(draft.args);
                    } catch {
                      throw new Error(
                        '命令参数必须是 JSON 字符串数组，例如 ["server.js"]',
                      );
                    }
                    if (
                      !Array.isArray(args) ||
                      !args.every((v) => typeof v === "string")
                    )
                      throw new Error("命令参数必须是 JSON 字符串数组");
                    patch.args = args;
                  }
                  if (draft.clearEnv) patch.envRefs = [];
                  else if (draft.envRefs.trim())
                    patch.envRefs = draft.envRefs
                      .split(/[,\s]+/)
                      .filter(Boolean);
                } else {
                  if (draft.url) patch.url = draft.url;
                  if (draft.clearBearer) patch.bearerEnv = null;
                  else if (draft.bearerEnv) patch.bearerEnv = draft.bearerEnv;
                }
                await changed("mcp/save", {
                  id: draft.id,
                  create: draft.create,
                  transport: draft.transport,
                  expectedRevision: draft.revision,
                  patch,
                });
              });
            }}
          >
            <label className="field-label">
              连接标识
              <input
                required
                pattern={"[a-z][a-z0-9_\\-]{0,63}"}
                maxLength={64}
                value={draft.id}
                autoFocus={draft.create}
                disabled={!!busy || !draft.create}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
            </label>
            <label className="field-label">
              传输方式
              <select
                aria-label="传输方式"
                value={draft.transport}
                disabled={!!busy || !draft.create}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    transport: e.target.value as "stdio" | "http",
                  })
                }
              >
                <option value="stdio">本地 stdio</option>
                <option value="http">HTTP</option>
              </select>
            </label>
            {draft.transport === "stdio" ? (
              <>
                <label className="field-label">
                  启动命令
                  <input
                    required={draft.create}
                    autoFocus={!draft.create}
                    disabled={!!busy}
                    maxLength={4096}
                    value={draft.command}
                    placeholder={draft.create ? "node" : "留空保留现有命令"}
                    onChange={(e) =>
                      setDraft({ ...draft, command: e.target.value })
                    }
                  />
                </label>
                <label className="field-label">
                  命令参数 JSON
                  <textarea
                    aria-label="命令参数 JSON"
                    disabled={!!busy}
                    rows={3}
                    maxLength={262144}
                    value={draft.args}
                    placeholder={'["/path/to/server.js"]'}
                    onChange={(e) =>
                      setDraft({ ...draft, args: e.target.value })
                    }
                  />
                  <span className="muted">
                    留空保留；[] 清空。只填写非敏感参数，不填写令牌或密码。
                  </span>
                </label>
                <label className="field-label">
                  环境变量引用
                  <input
                    aria-label="环境变量引用"
                    disabled={!!busy || draft.clearEnv}
                    autoComplete="off"
                    value={draft.envRefs}
                    onChange={(e) =>
                      setDraft({ ...draft, envRefs: e.target.value })
                    }
                  />
                  <span className="muted">
                    逗号分隔的服务端已授权变量名；留空保留，不填写变量值。
                  </span>
                </label>
                {!draft.create && (
                  <label className="provider-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.clearEnv}
                      disabled={!!busy}
                      onChange={(e) =>
                        setDraft({ ...draft, clearEnv: e.target.checked })
                      }
                    />
                    移除 env_vars 引用（已有 env 值保留）
                  </label>
                )}
              </>
            ) : (
              <>
                <label className="field-label">
                  服务地址
                  <input
                    type="url"
                    aria-label="服务地址"
                    required={draft.create}
                    autoFocus={!draft.create}
                    disabled={!!busy}
                    maxLength={2048}
                    value={draft.url}
                    placeholder={
                      draft.create
                        ? "https://example.com/mcp"
                        : "留空保留现有端点"
                    }
                    onChange={(e) =>
                      setDraft({ ...draft, url: e.target.value })
                    }
                  />
                  <span className="muted">
                    不含凭证、查询和片段；编辑时留空保留。
                  </span>
                </label>
                <label className="field-label">
                  Bearer 环境变量引用
                  <input
                    aria-label="Bearer 环境变量引用"
                    pattern="[A-Z_][A-Z0-9_]{0,127}"
                    maxLength={128}
                    autoComplete="off"
                    disabled={!!busy || draft.clearBearer}
                    value={draft.bearerEnv}
                    onChange={(e) =>
                      setDraft({ ...draft, bearerEnv: e.target.value })
                    }
                  />
                  <span className="muted">
                    服务端已授权变量名；留空保留，不填写 Token。
                  </span>
                </label>
                {!draft.create && (
                  <label className="provider-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.clearBearer}
                      disabled={!!busy}
                      onChange={(e) =>
                        setDraft({ ...draft, clearBearer: e.target.checked })
                      }
                    />
                    移除 Bearer 环境变量引用（其他凭证保留）
                  </label>
                )}
              </>
            )}
            <label className="field-label">
              启动超时（秒）
              <input
                type="number"
                min={1}
                max={120}
                required={draft.create}
                disabled={!!busy}
                value={draft.startup}
                onChange={(e) =>
                  setDraft({ ...draft, startup: e.target.value })
                }
              />
            </label>
            <label className="field-label">
              工具超时（秒）
              <input
                type="number"
                min={1}
                max={600}
                required={draft.create}
                disabled={!!busy}
                value={draft.timeout}
                onChange={(e) =>
                  setDraft({ ...draft, timeout: e.target.value })
                }
              />
            </label>
            <label className="provider-checkbox">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={!!busy}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              启用此连接
            </label>
            <div className="configuration-actions">
              <button className="primary" disabled={!!busy || recovery.blocked}>
                {busy === "save" && (
                  <LoaderCircle size={15} className="spin" aria-hidden="true" />
                )}
                保存
              </button>
            </div>
            {feedback}
            {busy && (
              <p className="muted" role="status">
                正在保存…
              </p>
            )}
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          open
          title="删除工具连接"
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          dismissible={!busy}
        >
          <div
            className="provider-editor"
            role="group"
            aria-label="确认删除工具连接"
          >
            <p>
              删除 {deleting.id} 的用户配置？历史 App 的后续工具交互可能不可用。
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
                确认删除 {deleting.id}
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
      {!draft && feedback}

      {notice && (
        <p className="configuration-notice" role="status">
          {notice}
        </p>
      )}
      <div className="configuration-actions">
        <button
          className="secondary"
          disabled={!!busy}
          onClick={() =>
            void action("read", async () => {
              await refresh();
              setDraft(null);
              setDeleting(null);
              setDiagnostic(null);
              setNotice("已读取最新连接配置。");
            })
          }
        >
          <RefreshCw size={15} aria-hidden="true" />
          {draft ? "读取最新并放弃连接修改" : "重新读取连接配置"}
        </button>
        <button
          className="secondary"
          disabled={
            !!busy || recovery.blocked || !!draft || !!deleting || !config
          }
          onClick={() =>
            void action("reload", async () => {
              await request("mcp/reload", {
                expectedRevision: config?.revision,
              });
              await refresh();
              setDiagnostic(null);
              setNotice("已提交原生 MCP 重载，请测试连接以确认目录可用。");
            })
          }
        >
          重载工具连接
        </button>
      </div>
    </section>
  );
}
