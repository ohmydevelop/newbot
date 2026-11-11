import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  LoaderCircle,
  RotateCw,
} from "lucide-react";
import type { Artifact } from "../../shared/types";
import { artifactFetch, attachArtifact } from "../artifacts";
import { Modal } from "./ui";
type Listing = {
  entries: { path: string; name: string; type: "directory" | "file" }[];
  nextOffset: number | null;
  truncated: boolean;
};
export default function WorkspaceFiles({
  threadId,
  turnId,
  onClose,
  onCloseAutoFocus,
}: {
  threadId: string;
  turnId: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [path, setPath] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSelected("");
    setListing(null);
    void artifactFetch(
      `/api/workspace/files?${new URLSearchParams({ threadId, path, offset: String(offset) })}`,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((value) => {
        if (!controller.signal.aborted) setListing(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          list.current?.scrollTo(0, 0);
        }
      });
    return () => controller.abort();
  }, [threadId, path, offset, revision]);
  useEffect(() => {
    setPath("");
    setOffset(0);
    setSelected("");
  }, [threadId]);
  function navigate(next: string) {
    setPath(next);
    setOffset(0);
  }
  async function register() {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await artifactFetch(
        `/api/threads/${encodeURIComponent(threadId)}/artifacts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnId, path: selected }),
        },
      );
      attachArtifact((await response.json()) as Artifact);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="添加工作区文件"
      wide
      className="workspace-modal"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <p className="workspace-description">
        将当前文件保存到本轮对话，之后的修改不会改变已保存的版本。
      </p>
      <div className="workspace-navigation">
        <button
          type="button"
          className="icon-button"
          aria-label="返回上层目录"
          disabled={!path || saving}
          onClick={() => navigate(path.split("/").slice(0, -1).join("/"))}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span title={path || "工作区"}>
          {path ? `工作区 / ${path}` : "工作区"}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新文件列表"
          disabled={loading || saving}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RotateCw size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="workspace-list" ref={list} aria-busy={loading}>
        {loading ? (
          <div className="artifact-state" role="status">
            <LoaderCircle size={22} className="spin" aria-hidden="true" />
            <p>正在读取工作区…</p>
          </div>
        ) : listing?.entries.length ? (
          <ul aria-label="工作区文件">
            {listing.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  disabled={saving}
                  aria-pressed={
                    entry.type === "file" ? selected === entry.path : undefined
                  }
                  onClick={() =>
                    entry.type === "directory"
                      ? navigate(entry.path)
                      : setSelected(entry.path)
                  }
                >
                  <span className="workspace-entry-icon">
                    {entry.type === "directory" ? (
                      <Folder size={19} aria-hidden="true" />
                    ) : (
                      <FileText size={19} aria-hidden="true" />
                    )}
                  </span>
                  <span title={entry.name}>{entry.name}</span>
                  {entry.type === "directory" && (
                    <ChevronRight size={16} aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          listing && (
            <div className="artifact-state">
              <Folder size={25} aria-hidden="true" />
              <p>此目录没有可添加的文件。</p>
            </div>
          )
        )}
      </div>
      {error && (
        <p className="inline-error artifact-inline-error" role="alert">
          {error}
        </p>
      )}
      {listing?.truncated && (
        <p className="artifact-preview-note workspace-limit">
          目录内容较多，仅显示部分文件。请进入具体目录查找。
        </p>
      )}
      {(offset > 0 ||
        (listing?.nextOffset !== null &&
          listing?.nextOffset !== undefined)) && (
        <nav className="workspace-pagination" aria-label="文件列表分页">
          <button
            type="button"
            disabled={!offset || saving || loading}
            onClick={() => setOffset((n) => Math.max(0, n - 100))}
          >
            上一页
          </button>
          <span>第 {offset / 100 + 1} 页</span>
          <button
            type="button"
            disabled={listing?.nextOffset == null || saving || loading}
            onClick={() => setOffset(listing!.nextOffset!)}
          >
            下一页
          </button>
        </nav>
      )}
      <footer className="workspace-footer">
        <span title={selected}>{selected || "选择一个文件"}</span>
        <button
          type="button"
          className="primary"
          disabled={!selected || saving || loading}
          onClick={() => void register()}
        >
          {saving && (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          )}
          {saving ? "正在保存…" : "添加到本轮对话"}
        </button>
      </footer>
    </Modal>
  );
}
