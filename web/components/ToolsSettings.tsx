import SkillImport from "./SkillImport";
import PluginComponents from "./PluginComponents";
import { CatalogToolbar } from "./CatalogToolbar";
import { useEffect, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  Cable,
  Blocks,
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
import { Modal } from "./ui";
export default function ToolsSettings({
  mode = "plugins",
}: {
  mode?: "plugins" | "connectors";
}) {
  const s = useApp(),
    [catalog, setCatalog] = useState<Json | null>(null),
    [detail, setDetail] = useState<Json | null>(null),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [importing, setImporting] = useState(false),
    [updating, setUpdating] = useState<Json | null>(null),
    [marketUpdate, setMarketUpdate] = useState<Json | null>(null),
    [available, setAvailable] = useState(false),
    [create, setCreate] = useState(0),
    [remove, setRemove] = useState<Json | null>(null);
  async function read() {
    setBusy(true);
    setError("");
    try {
      setCatalog(await request("plugin/list", { includeTools: true }));
    } catch {
      setError("插件目录读取失败，请刷新重试。");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (mode === "plugins") void read();
    else void loadDiscovery("mcp");
  }, [mode]);
  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      setDetail(await request("plugin/read", { id }));
    } catch {
      setError("详情读取失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function action(method: string, entry: Json, enabled?: boolean) {
    setBusy(true);
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
      setRemove(null);
      setMarketUpdate(null);
      await loadSettings();
      setCatalog(await request("plugin/list", { includeTools: true }));
      if (detail?.id === entry.id)
        setDetail(await request("plugin/read", { id: entry.id }));
    } catch (e) {
      setError(
        committed
          ? "操作已完成，目录读取失败。请刷新查看最新状态。"
          : e instanceof Error
            ? e.message
            : "操作未完成，请刷新确认。",
      );
    } finally {
      setBusy(false);
    }
  }
  const entries: Json[] = catalog?.entries || [];
  function update(entry: Json) {
    setDetail(null);
    if (entry.update.kind === "import") {
      setUpdating(entry);
      setImporting(true);
    } else setMarketUpdate(entry);
  }
  const matches = (p: Json) =>
    `${p.displayName} ${p.name}`.toLowerCase().includes(query.toLowerCase());
  return (
    <section
      className="tools-catalog"
      aria-label={mode === "plugins" ? "插件管理" : "连接器管理"}
    >
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
      <CatalogToolbar
        label={mode === "plugins" ? "插件" : "连接器"}
        query={query}
        onQuery={setQuery}
      >
        <button
          type="button"
          className="icon-button"
          aria-label={mode === "plugins" ? "添加插件" : "添加连接器"}
          title={mode === "plugins" ? "添加插件" : "添加连接器"}
          disabled={mode === "connectors" && !s.settings?.configuration}
          onClick={() =>
            mode === "plugins" ? setAvailable(true) : setCreate((v) => v + 1)
          }
        >
          <Plus size={20} />
        </button>
        <button
          className="icon-button"
          title={mode === "plugins" ? "刷新插件" : "刷新连接器"}
          aria-label={mode === "plugins" ? "刷新插件" : "刷新连接器"}
          disabled={busy}
          onClick={() =>
            void (async () => {
              try {
                await loadSettings();
                if (mode === "connectors") await loadDiscovery("mcp");
                else await read();
              } catch {
                setError("读取失败，请恢复连接后重试。");
              }
            })()
          }
        >
          <RefreshCw size={18} className={busy ? "spin" : ""} />
        </button>
      </CatalogToolbar>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {mode === "plugins" && catalog?.warnings > 0 && (
        <p role="status" className="muted">
          部分插件详情读取失败，请刷新重试。
        </p>
      )}
      {mode === "plugins" &&
        entries
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
                <span>
                  <strong>{p.displayName}</strong>
                  <small>
                    {p.description || (p.enabled ? "已启用" : "已停用")}
                  </small>
                </span>
              </button>
              <Dropdown.Root>
                <Dropdown.Trigger
                  className="icon-button catalog-more"
                  aria-label={`${p.displayName} 更多操作`}
                  title="更多操作"
                  disabled={busy}
                >
                  <MoreHorizontal size={20} />
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
      {mode === "connectors" && (
        <McpSettings embedded query={query} createSignal={create} />
      )}
      {available && (
        <Modal
          open
          title="添加插件"
          wide
          className="catalog-detail-modal"
          onOpenChange={(open) => {
            if (!open) setAvailable(false);
          }}
        >
          <button
            className="secondary"
            onClick={() => {
              setAvailable(false);
              setImporting(true);
            }}
          >
            从目录、ZIP 或 GitHub 导入
          </button>
          <div className="catalog-detail-body">
            {!catalog?.available && (
              <p role="status">{catalog?.reason || "正在读取…"}</p>
            )}
            {catalog?.available && !entries.some((p) => !p.installed) && (
              <p className="muted">已配置市场暂无可添加的插件。</p>
            )}
            {entries
              .filter((p) => !p.installed)
              .map((p) => (
                <div className="catalog-entry" key={p.id}>
                  <button
                    type="button"
                    className="catalog-entry-main"
                    onClick={() => void open(p.id)}
                  >
                    <CatalogIcon name={p.name} kind="plugin" />
                    <span>
                      <strong>{p.displayName}</strong>
                      <small>{p.description}</small>
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`安装 ${p.displayName}`}
                    title="安装"
                    disabled={busy || !p.available || !p.installable}
                    onClick={() => void action("plugin/install", p)}
                  >
                    <Plus size={20} />
                  </button>
                </div>
              ))}
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
      {detail && (
        <Modal
          open
          title={detail.displayName}
          wide
          className="catalog-detail-modal"
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
              onUpdate={setDetail}
            />
            {!!detail.tools?.filter(
              (name: string) =>
                !detail.connections?.some((c: Json) => c.id === name),
            ).length && (
              <>
                <h4>连接器</h4>
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
        </Modal>
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
