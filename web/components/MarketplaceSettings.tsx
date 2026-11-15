import { useOperationScope } from "../use-operation-scope";
import { FormActions, FormSubmit } from "./FormActions";
import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { CatalogDetail } from "./CatalogNavigation";
import { StoreIcon } from "./AppIcons";
import { request, loadSettings } from "../store";
import type { MarketplaceView } from "../../shared/marketplaces";
export default function MarketplaceSettings({
  onClose,
}: {
  onClose: () => void;
}) {
  const [view, setView] = useState<MarketplaceView | null>(null),
    [adding, setAdding] = useState(false),
    [source, setSource] = useState(""),
    [error, setError] = useState("");
  const operation = useRef<{ body: string; id: string } | null>(null);
  const scope = useOperationScope();
  const busy = scope.busy;
  async function load() {
    const task = scope.start("read", "list");
    if (!task) return;
    setError("");
    try {
      const result = await request<MarketplaceView>(
        "marketplace/list",
        {},
        { signal: task.signal },
      );
      if (task.isCurrent()) setView(result);
    } catch (e) {
      if (task.isCurrent())
        setError(e instanceof Error ? e.message : "读取失败，请重试");
    } finally {
      task.finish();
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function change(
    action: string,
    entry?: MarketplaceView["entries"][number],
  ) {
    if (!view) return;
    const task = scope.start("write", entry?.id || "add");
    if (!task) return;
    const body = {
      expectedRevision: view.revision,
      ...(entry ? { id: entry.id } : { source }),
    };
    const signature = JSON.stringify({ action, ...body });
    if (operation.current?.body !== signature)
      operation.current = { body: signature, id: crypto.randomUUID() };
    setError("");
    let committed = false;
    try {
      await request(action, { ...body, operationId: operation.current.id });
      committed = true;
      operation.current = null;
      if (!task.isCurrent()) return;
      setAdding(false);
      setSource("");
      await loadSettings();
      if (!task.isCurrent()) return;
      const result = await request<MarketplaceView>("marketplace/list");
      if (task.isCurrent()) setView(result);
    } catch (e) {
      if (task.isCurrent())
        setError(
          committed
            ? "操作已完成，商店目录读取失败。请刷新查看最新状态。"
            : e instanceof Error
              ? e.message
              : "操作失败，请重试",
        );
    } finally {
      task.finish();
    }
  }
  return (
    <CatalogDetail
      open
      title="插件商店"
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      dismissible={!busy || busy === "list"}
      className="catalog-management"
    >
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="catalog-section-heading">
        <span>已添加的商店</span>
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => {
            setAdding(true);
            setError("");
          }}
        >
          <Plus size={16} />
          添加商店
        </button>
      </div>
      {!view ? (
        <p className="muted">正在读取…</p>
      ) : (
        view.entries.map((entry) => (
          <div className="marketplace-row" key={entry.id}>
            <StoreIcon size={20} />
            <div className="marketplace-name">
              <strong>{entry.displayName}</strong>
              <span>
                {entry.managed ? entry.source : "由运行环境提供"} ·{" "}
                {entry.plugins} 个插件
              </span>
            </div>
            {entry.managed && (
              <>
                <button
                  className="icon-button"
                  aria-label={`更新 ${entry.displayName}`}
                  disabled={!!busy}
                  onClick={() => void change("marketplace/upgrade", entry)}
                >
                  <RefreshCw
                    size={17}
                    className={busy === entry.id ? "spin" : ""}
                  />
                </button>
                <button
                  className="icon-button"
                  aria-label={`移除 ${entry.displayName}`}
                  title={entry.installed ? "先卸载此商店的插件" : "移除商店"}
                  disabled={!!busy || entry.installed > 0}
                  onClick={() => void change("marketplace/remove", entry)}
                >
                  <Trash2 size={17} />
                </button>
              </>
            )}
          </div>
        ))
      )}
      <button
        className="text-button"
        disabled={!!busy}
        onClick={() => void load()}
      >
        刷新商店
      </button>
      {adding && (
        <CatalogDetail
          open
          title="添加商店"
          onOpenChange={(v) => {
            if (!v) {
              setAdding(false);
              setError("");
            }
          }}
          dismissible={!busy || busy === "list"}
          className="catalog-form-step"
        >
          <form
            className="catalog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void change("marketplace/add");
            }}
          >
            <label className="field-label">
              <span className="sr-only">商店链接</span>
              <input
                autoFocus
                required
                value={source}
                disabled={!!busy}
                placeholder="粘贴仓库或商店目录链接"
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <FormActions layout="catalog">
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() => {
                  setAdding(false);
                  setError("");
                }}
              >
                取消
              </button>
              <FormSubmit busy={!!busy} disabled={!view} busyLabel="正在添加…">
                添加商店
              </FormSubmit>
            </FormActions>
          </form>
        </CatalogDetail>
      )}
    </CatalogDetail>
  );
}
