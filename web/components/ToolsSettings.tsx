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
} from "lucide-react";
import type { Json } from "../../shared/types";
import { request, loadSettings, useApp } from "../store";
import McpSettings from "./McpSettings";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import CatalogIcon from "./CatalogIcon";
import { Modal } from "./ui";
export default function ToolsSettings() {
  const s = useApp(),
    [catalog, setCatalog] = useState<Json | null>(null),
    [detail, setDetail] = useState<Json | null>(null),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [available, setAvailable] = useState(false),
    [create, setCreate] = useState(0),
    [remove, setRemove] = useState<Json | null>(null);
  async function read() {
    setBusy(true);
    setError("");
    try {
      setCatalog(await request("plugin/list", { includeTools: true }));
    } catch {
      setError("工具目录读取失败，请刷新重试。");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void read();
  }, []);
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
    try {
      await request(method, {
        id: entry.id,
        enabled,
        expectedRevision: useApp.getState().settings?.configuration?.revision,
      });
      await loadSettings();
      setCatalog(await request("plugin/list", { includeTools: true }));
      if (detail?.id === entry.id)
        setDetail(await request("plugin/read", { id: entry.id }));
      setRemove(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请刷新确认。");
    } finally {
      setBusy(false);
    }
  }
  const entries: Json[] = catalog?.entries || [],
    owned = [
      ...entries.filter((p) => p.installed).flatMap((p) => p.tools || []),
      ...(s.settings?.mcp || [])
        .filter((m: Json) =>
          entries.some((p) => p.installed && p.id === m.pluginId),
        )
        .map((m: Json) => m.name),
    ];
  const matches = (p: Json) =>
    `${p.displayName} ${p.name}`.toLowerCase().includes(query.toLowerCase());
  return (
    <section className="tools-catalog" aria-label="工具与插件管理">
      <div className="section-heading">
        <h3>工具连接</h3>
        <div className="section-actions">
          <Dropdown.Root>
            <Dropdown.Trigger
              className="icon-button"
              aria-label="添加工具或插件"
              title="添加"
            >
              <Plus size={20} />
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <ActionMenuContent
                className="dropdown"
                align="end"
                sideOffset={5}
              >
                <ActionMenuItem
                  icon={Cable}
                  onSelect={() => setCreate((v) => v + 1)}
                >
                  添加工具连接
                </ActionMenuItem>
                <ActionMenuItem
                  icon={Blocks}
                  onSelect={() => setAvailable(true)}
                >
                  添加插件
                </ActionMenuItem>
              </ActionMenuContent>
            </Dropdown.Portal>
          </Dropdown.Root>
          <button
            className="icon-button"
            title="刷新工具目录"
            aria-label="刷新工具目录"
            disabled={busy}
            onClick={() =>
              void (async () => {
                try {
                  await loadSettings();
                  await read();
                } catch {
                  setError("读取失败，请恢复连接后重试。");
                }
              })()
            }
          >
            <RefreshCw size={18} className={busy ? "spin" : ""} />
          </button>
        </div>
      </div>
      <input
        className="catalog-search"
        type="search"
        aria-label="搜索工具与插件"
        placeholder="搜索工具与插件"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
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
                    查看详情
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
      <McpSettings
        embedded
        query={query}
        excludeNames={owned}
        createSignal={create}
      />
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
            {!!detail.skills?.length && (
              <>
                <h4>技能</h4>
                {detail.skills.map((skill: Json) => (
                  <div className="catalog-detail-line" key={skill.name}>
                    <strong>{skill.name}</strong>
                    <p className="muted">{skill.description}</p>
                  </div>
                ))}
              </>
            )}
            {!!detail.tools?.length && (
              <>
                <h4>工具连接</h4>
                <McpSettings
                  embedded
                  onlyNames={[
                    ...detail.tools,
                    ...(s.settings?.mcp || [])
                      .filter((m: Json) => m.pluginId === detail.id)
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
          <p>该插件提供的技能与工具连接将一起移除。</p>
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
    </section>
  );
}
