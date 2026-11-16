import { CatalogAddButton } from "./CatalogAddButton";
import { useCatalogField } from "../catalog-state";
import { CatalogFilter } from "./CatalogFilter";
import { CatalogCopy } from "./CatalogCopy";
import { useOperationScope } from "../use-operation-scope";
import { CatalogRefreshButton } from "./CatalogRefreshButton";
import MarketplaceSettings from "./MarketplaceSettings";
import {
  PluginIcon as Blocks,
  ConnectionIcon,
  StoreIcon,
  ImportIcon,
} from "./AppIcons";
import SkillImport from "./SkillImport";
import PluginComponents from "./PluginComponents";
import { CatalogToolbar } from "./CatalogToolbar";
import { useEffect, useRef, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Plus,
  RefreshCw,
  ChevronDown,
  Check,
  Settings2,
  Power,
  PowerOff,
  Trash2,
  ArrowUpCircle,
} from "lucide-react";
import type { Json } from "../../shared/types";
import { request, loadSettings, loadDiscovery, useApp } from "../store";
import McpSettings from "./McpSettings";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import CatalogIcon from "./CatalogIcon";
import { MoreIcon as MoreHorizontal } from "./ReferenceIcons";
import { Modal } from "./ui";
import { CatalogDetail, CatalogUse } from "./CatalogNavigation";
export default function ToolsSettings({
  mode = "plugins",
}: {
  mode?: "plugins" | "connectors";
}) {
  const s = useApp(),
    [catalog, setCatalog] = useState<Json | null>(null),
    [detail, setDetail] = useState<Json | null>(null),
    [query, setQuery] = useCatalogField("connectors", "query"),
    [marketplace, setMarketplace] = useCatalogField("connectors", "filter"),
    [managingMarkets, setManagingMarkets] = useState(false),
    [error, setError] = useState(""),
    [importing, setImporting] = useState(false),
    [updating, setUpdating] = useState<Json | null>(null),
    [marketUpdate, setMarketUpdate] = useState<Json | null>(null),
    [create, setCreate] = useState(0),
    [remove, setRemove] = useState<Json | null>(null);
  const operation = useOperationScope();
  const busy = !!operation.busy;
  const detailOrigin = useRef<HTMLElement | null>(null);
  async function read(refresh = false) {
    const task = operation.start("read", refresh ? "refresh" : "list");
    if (!task) return;
    setError("");
    try {
      if (refresh) {
        // Shared settings/discovery keep their own lifetime; only this page continuation expires.
        await loadSettings();
        if (!task.isCurrent()) return;
        await loadDiscovery("mcp");
        if (!task.isCurrent()) return;
      }
      const result = await request(
        "plugin/list",
        { includeTools: true },
        { signal: task.signal },
      );
      if (task.isCurrent()) setCatalog(result);
    } catch {
      if (task.isCurrent()) setError("插件目录读取失败，请刷新重试。");
    } finally {
      task.finish();
    }
  }
  useEffect(() => {
    void read();
    void loadDiscovery("mcp");
  }, []);
  async function open(id: string) {
    const task = operation.start("read", `detail:${id}`);
    if (!task) return;
    detailOrigin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setError("");
    try {
      const result = await request(
        "plugin/read",
        { id },
        { signal: task.signal },
      );
      if (task.isCurrent()) setDetail(result);
    } catch (error) {
      if (task.isCurrent())
        setError(
          error instanceof Error ? error.message : "详情读取失败，请重试。",
        );
    } finally {
      task.finish();
    }
  }
  async function action(method: string, entry: Json, enabled?: boolean) {
    const task = operation.start("write", method);
    if (!task) return;
    setError("");
    let committed = false;
    try {
      await request(method, {
        id: entry.id,
        enabled,
        expectedRevision: useApp.getState().settings?.configuration?.revision,
        ...(method === "plugin/update"
          ? {
              expectedVersion: entry.update.currentVersion,
              targetVersion: entry.update.latestVersion,
            }
          : {}),
      });
      committed = true;
      if (!task.isCurrent()) return;
      setRemove(null);
      setMarketUpdate(null);
      await loadSettings();
      if (!task.isCurrent()) return;
      const catalog = await request("plugin/list", { includeTools: true });
      if (!task.isCurrent()) return;
      setCatalog(catalog);
      if (method === "plugin/uninstall")
        setDetail((current) => (current?.id === entry.id ? null : current));
      else if (detail?.id === entry.id) {
        const result = await request("plugin/read", { id: entry.id });
        if (task.isCurrent())
          setDetail((current) => (current?.id === entry.id ? result : current));
      }
    } catch (e) {
      if (!task.isCurrent()) return;
      setError(
        committed
          ? "操作已完成，目录读取失败。请刷新查看最新状态。"
          : e instanceof Error
            ? e.message
            : "操作未完成，请刷新确认。",
      );
    } finally {
      task.finish();
    }
  }
  const entries: Json[] = catalog?.entries || [];
  const marketOptions = [
    { name: "", label: "全部商店" },
    ...(
      catalog?.marketplaces ||
      [...new Set(entries.map((p) => p.marketplace))]
        .filter(Boolean)
        .map((name) => ({ name, displayName: name }))
    ).map((market: Json) => ({
      name: market.name,
      label:
        market.name === "newbot-imports"
          ? "自定义导入"
          : market.displayName || market.name,
    })),
  ];
  function update(entry: Json) {
    setDetail(null);
    if (entry.update.kind === "import") {
      setUpdating(entry);
      setImporting(true);
    } else setMarketUpdate(entry);
  }
  const matches = (p: Json) =>
    (!marketplace || p.marketplace === marketplace) &&
    `${p.displayName} ${p.name} ${p.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
  return (
    <section className="tools-catalog" data-mode="all" aria-label="连接器管理">
      {importing && (
        <SkillImport
          kind="plugin"
          updatePlugin={
            updating
              ? {
                  id: updating.id,
                  name: updating.name,
                  displayName: updating.displayName,
                }
              : undefined
          }
          onClose={() => {
            setImporting(false);
            setUpdating(null);
            void read();
          }}
        />
      )}
      {managingMarkets && (
        <MarketplaceSettings
          onClose={() => {
            setManagingMarkets(false);
            void read();
          }}
        />
      )}
      <CatalogToolbar label="连接器" query={query} onQuery={setQuery}>
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <CatalogAddButton label="添加连接器" />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <ActionMenuContent className="dropdown" align="end" sideOffset={6}>
              <ActionMenuItem
                icon={ConnectionIcon}
                disabled={!s.settings?.configuration}
                onSelect={() => setCreate((v) => v + 1)}
              >
                连接器
              </ActionMenuItem>
              <ActionMenuItem
                icon={ImportIcon}
                onSelect={() => setImporting(true)}
              >
                导入插件
              </ActionMenuItem>
              <ActionMenuItem
                icon={StoreIcon}
                onSelect={() => setManagingMarkets(true)}
              >
                管理商店
              </ActionMenuItem>
            </ActionMenuContent>
          </Dropdown.Portal>
        </Dropdown.Root>
        <CatalogRefreshButton
          label={mode === "plugins" ? "刷新插件" : "刷新连接器"}
          busy={busy}
          onClick={() => void read(true)}
        />
      </CatalogToolbar>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {catalog?.warnings > 0 && (
        <p role="status" className="muted">
          部分插件详情读取失败，请刷新重试。
        </p>
      )}
      <div className="catalog-market-filter">
        <CatalogFilter
          label="插件商店"
          value={marketplace}
          onValueChange={setMarketplace}
          options={marketOptions.map((market) => ({
            value: market.name,
            label: market.label,
          }))}
        />
      </div>
      <h3 className="catalog-group-title">已添加</h3>
      <div className="catalog-grid">
        {entries
          .filter((p) => p.installed && matches(p))
          .map((p) => (
            <div className="catalog-entry plugin-entry" key={p.id}>
              <button
                type="button"
                className="catalog-entry-main"
                aria-label={`查看 ${p.displayName}`}
                disabled={busy}
                onClick={() => void open(p.id)}
              >
                <CatalogIcon name={p.name} kind="plugin" />
                <CatalogCopy
                  name={p.displayName}
                  description={p.description}
                  status={
                    p.needsRepair ? (
                      "需要修复"
                    ) : p.enabled ? (
                      <>
                        <Check size={14} /> 已启用
                      </>
                    ) : (
                      "已停用"
                    )
                  }
                />
              </button>
              <Dropdown.Root>
                <Dropdown.Trigger
                  className="icon-button catalog-more"
                  aria-label={`${p.displayName} 更多操作`}
                  title="更多操作"
                  disabled={busy}
                >
                  <MoreHorizontal size={16} />
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <ActionMenuContent
                    className="dropdown"
                    align="end"
                    sideOffset={5}
                  >
                    <ActionMenuItem
                      icon={Settings2}
                      onSelect={() => void open(p.id)}
                    >
                      详情
                    </ActionMenuItem>
                    {p.needsRepair && (
                      <ActionMenuItem
                        icon={RefreshCw}
                        disabled={!p.available || !p.installable}
                        onSelect={() => void action("plugin/install", p)}
                      >
                        重新安装
                      </ActionMenuItem>
                    )}
                    <ActionMenuItem
                      icon={p.enabled ? PowerOff : Power}
                      disabled={!p.available}
                      onSelect={() =>
                        void action("plugin/enabled", p, !p.enabled)
                      }
                    >
                      {p.enabled ? "停用" : "启用"}
                    </ActionMenuItem>
                    <ActionMenuItem
                      icon={ArrowUpCircle}
                      disabled={!p.available || !p.update?.available}
                      title={
                        p.update?.available ? "升级插件" : p.update?.reason
                      }
                      onSelect={() => update(p)}
                    >
                      升级
                    </ActionMenuItem>
                    <ActionMenuItem
                      icon={Trash2}
                      destructive
                      separated
                      onSelect={() => setRemove(p)}
                    >
                      卸载
                    </ActionMenuItem>
                  </ActionMenuContent>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>
          ))}
      </div>
      <div hidden={!!marketplace}>
        <McpSettings embedded query={query} createSignal={create} />
      </div>
      {catalog &&
        !entries.some((p) => p.installed && matches(p)) &&
        (!!marketplace ||
          !(s.settings?.configuration?.mcp || []).some((c: Json) =>
            `${c.name || ""} ${c.id}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )) && (
          <p className="catalog-empty">
            {query ? "没有匹配的连接器" : "尚未添加连接器"}
          </p>
        )}
      {!!entries.filter((p) => !p.installed && matches(p)).length && (
        <>
          <h3 className="catalog-group-title">可添加</h3>
          <div className="catalog-grid">
            {entries
              .filter((p) => !p.installed && matches(p))
              .map((p) => (
                <div className="catalog-entry" key={p.id}>
                  <button
                    className="catalog-entry-main"
                    onClick={() => void open(p.id)}
                  >
                    <CatalogIcon name={p.name} kind="plugin" />
                    <CatalogCopy
                      name={p.displayName}
                      description={p.description}
                    />
                  </button>
                  <button
                    className="secondary catalog-install"
                    disabled={busy || !p.available || !p.installable}
                    onClick={() => void action("plugin/install", p)}
                  >
                    添加
                  </button>
                </div>
              ))}
          </div>
        </>
      )}

      {detail && (
        <CatalogDetail
          open
          title={detail.displayName}
          returnFocus={detailOrigin.current}
          dismissible={!busy}
          wide
          className="catalog-detail-modal"
          headerActions={
            detail.installed ? (
              <CatalogUse
                kind="@"
                entry={detail}
                disabled={!detail.enabled || !detail.available || busy}
              />
            ) : undefined
          }
          onOpenChange={(open) => {
            if (!open) setDetail(null);
          }}
        >
          <div className="catalog-detail-body">
            <div className="catalog-detail-heading">
              <CatalogIcon name={detail.name} kind="plugin" />
              <p>{detail.description}</p>
            </div>
            <PluginComponents
              key={detail.id}
              detail={detail}
              onUpdate={(result) =>
                setDetail((current) =>
                  current === detail && current?.id === result.id
                    ? result
                    : current,
                )
              }
            />
            {!!detail.tools?.filter(
              (name: string) =>
                !detail.connections?.some((c: Json) => c.id === name),
            ).length && (
              <>
                <h4>连接器</h4>
                {detail.installed ? (
                  <McpSettings
                    embedded
                    onlyNames={[
                      ...detail.tools.filter(
                        (name: string) =>
                          !detail.connections?.some((c: Json) => c.id === name),
                      ),
                      ...(s.settings?.mcp || [])
                        .filter(
                          (m: Json) =>
                            m.pluginId === detail.id &&
                            !detail.connections?.some(
                              (c: Json) => c.id === m.name,
                            ),
                        )
                        .map((m: Json) => m.name),
                    ]}
                  />
                ) : (
                  <div className="catalog-grid">
                    {detail.tools.map((name: string) => (
                      <div className="catalog-entry" key={name}>
                        <div className="catalog-entry-main">
                          <CatalogIcon name={name} kind="connection" />
                          <span>
                            <strong>{name}</strong>
                            <small className="connection-summary">
                              安装后可配置
                            </small>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="editor-actions">
              {detail.installed ? (
                <>
                  <button
                    className="secondary"
                    disabled={
                      busy || !detail.available || !detail.update?.available
                    }
                    title={
                      detail.update?.available
                        ? "升级插件"
                        : detail.update?.reason
                    }
                    onClick={() => update(detail)}
                  >
                    <ArrowUpCircle size={16} />
                    升级
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !detail.available}
                    onClick={() =>
                      void action("plugin/enabled", detail, !detail.enabled)
                    }
                  >
                    {detail.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    className="secondary danger-text"
                    disabled={busy}
                    onClick={() => setRemove(detail)}
                  >
                    卸载
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={busy || !detail.installable || !detail.available}
                  onClick={() => void action("plugin/install", detail)}
                >
                  安装
                </button>
              )}
            </div>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
          </div>
        </CatalogDetail>
      )}
      {remove && (
        <Modal
          open
          title={`卸载 ${remove.displayName}`}
          onOpenChange={(open) => {
            if (!open) setRemove(null);
          }}
          dismissible={!busy}
        >
          <p>该插件提供的技能与连接器将一起移除。</p>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setRemove(null)}
            >
              保留
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={() => void action("plugin/uninstall", remove)}
            >
              卸载
            </button>
          </div>
        </Modal>
      )}
      {marketUpdate && (
        <Modal
          open
          title={`升级 ${marketUpdate.displayName}`}
          dismissible={!busy}
          onOpenChange={(open) => {
            if (!open) setMarketUpdate(null);
          }}
        >
          <p>
            {marketUpdate.update.currentVersion} →{" "}
            {marketUpdate.update.latestVersion}
          </p>
          <p className="muted">
            保留已有启停选择，新增技能默认关闭。完成后下一轮使用新版本。
          </p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setMarketUpdate(null)}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void action("plugin/update", marketUpdate)}
            >
              {busy ? "正在升级…" : "确认升级"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
