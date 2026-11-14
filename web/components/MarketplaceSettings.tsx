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
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const operation = useRef<{ body: string; id: string } | null>(null);
  const load = async () => setView(await request("marketplace/list"));
  useEffect(() => {
    let live = true;
    request<MarketplaceView>("marketplace/list")
      .then((v) => {
        if (live) setView(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function change(
    action: string,
    entry?: MarketplaceView["entries"][number],
  ) {
    if (busy || !view) return;
    const body = {
      expectedRevision: view.revision,
      ...(entry ? { id: entry.id } : { source }),
    };
    const signature = JSON.stringify({ action, ...body });
    if (operation.current?.body !== signature)
      operation.current = { body: signature, id: crypto.randomUUID() };
    setBusy(entry?.id || "add");
    setError("");
    try {
      await request(action, { ...body, operationId: operation.current.id });
      operation.current = null;
      setAdding(false);
      setSource("");
      await loadSettings();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy("");
    }
  }
  return (
    <CatalogDetail
      open
      title="插件商店"
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      dismissible={!busy}
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
        onClick={() => void load().catch((e) => setError(e.message))}
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
          dismissible={!busy}
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
            <div className="catalog-form-actions">
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
              <button className="primary" disabled={!!busy || !view}>
                {busy ? "正在添加…" : "添加商店"}
              </button>
            </div>
          </form>
        </CatalogDetail>
      )}
    </CatalogDetail>
  );
}
