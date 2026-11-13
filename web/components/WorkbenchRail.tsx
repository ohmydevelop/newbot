import { useEffect, useRef, useState } from "react";
import {
  ChevronsRight,
  FileCode2,
  FolderOpen,
  Layers,
  Plus,
  X,
} from "lucide-react";
import type { Artifact, Thread } from "../../shared/types";
import { formatFileSize } from "../../shared/artifact-preview";
import { useMediaQuery } from "../media";

type RailTab = "associations" | "files" | "artifacts";

const tabs: { id: RailTab; label: string; icon: typeof Layers }[] = [
  { id: "associations", label: "会话关联", icon: Layers },
  { id: "files", label: "工作区文件", icon: FolderOpen },
  { id: "artifacts", label: "产物", icon: FileCode2 },
];

/**
 * Persistent right-hand workbench column. Tabs are generic so more panels
 * (files, artifacts, later sub-agents) can share one strip without moving chat.
 */
export default function WorkbenchRail({
  thread,
  busy,
  onClose,
  onRemove,
  onPickFiles,
  onOpenArtifact,
}: {
  thread?: Thread;
  busy: boolean;
  onClose: () => void;
  onRemove: (kind: "plugins" | "skills", id: string) => void;
  onPickFiles: () => void;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const stored = (): RailTab => {
    const value = localStorage.getItem("newbot:rail-tab");
    return tabs.some((t) => t.id === value) ? (value as RailTab) : "associations";
  };
  const [tab, setTab] = useState<RailTab>(stored);
  useEffect(() => {
    localStorage.setItem("newbot:rail-tab", tab);
  }, [tab]);
  const narrow = useMediaQuery("(max-width: 1080px)");
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem("newbot:rail-width"));
    return Number.isFinite(saved) && saved >= 260 && saved <= 520 ? saved : 300;
  });
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  function onResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (narrow) return;
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onResizeMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const next = Math.min(
      520,
      Math.max(260, drag.current.startWidth - (event.clientX - drag.current.startX)),
    );
    setWidth(next);
  }
  function onResizeEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    localStorage.setItem("newbot:rail-width", String(width));
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const plugins = (thread?.nextInput?.plugins || []).map((x) => ({
    id: x.id,
    name: x.displayName || x.name,
  }));
  const skills = (thread?.nextInput?.skills || []).map((x) => ({
    id: x.id,
    name: x.displayName || x.name,
  }));
  const artifacts = [
    ...new Map(
      thread?.turns
        .flatMap((turn) => turn.artifacts || [])
        .filter((a) => a.source !== "media")
        .sort((a, b) => a.version - b.version)
        .map((a) => [a.path, a]),
    ).values(),
  ].reverse();
  return (
    <aside
      className={`rail ${narrow ? "rail-overlay" : ""}`}
      aria-label="右侧工作区"
      style={narrow ? undefined : { flexBasis: width, width }}
    >
      <div
        className="rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整右侧栏宽度"
        title="拖动调整宽度"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
      <div className="rail-tabs" role="tablist" aria-label="侧栏面板">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`rail-tab ${tab === t.id ? "selected" : ""}`}
            title={t.label}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={17} aria-hidden="true" />
            <span className="sr-only">{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="rail-tab rail-tab-add"
          disabled
          title="更多面板即将支持"
          aria-label="更多面板即将支持"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <span className="rail-spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label="收起右侧栏"
          title="收起右侧栏"
          onClick={onClose}
        >
          <ChevronsRight size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="rail-body" role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label}>
        {tab === "associations" && (
          <>
            <p className="muted association-hint">
              这些插件与技能会用于本会话的后续消息，移除后立即生效。
            </p>
            {[
              { key: "plugins" as const, label: "插件", items: plugins },
              { key: "skills" as const, label: "技能", items: skills },
            ].map((group) => (
              <section key={group.key} className="association-group">
                <h3>
                  {group.label}
                  <span>{group.items.length}</span>
                </h3>
                {group.items.length === 0 ? (
                  <p className="muted">暂无</p>
                ) : (
                  group.items.map((item) => (
                    <div className="association-row" key={item.id}>
                      <span title={item.name}>{item.name}</span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`移除 ${item.name}`}
                        title="移除"
                        disabled={busy}
                        onClick={() => onRemove(group.key, item.id)}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  ))
                )}
              </section>
            ))}
            <p className="muted association-hint">
              连接器（MCP）由插件提供，可在此移除插件，或在插件设置中管理。
            </p>
          </>
        )}
        {tab === "files" && (
          <>
            <p className="muted association-hint">
              把工作区里的文件保存到本会话，之后的修改不影响已保存版本。
            </p>
            <button
              type="button"
              className="secondary rail-action"
              disabled={!thread}
              onClick={onPickFiles}
            >
              <FolderOpen size={16} aria-hidden="true" />
              选择工作区文件
            </button>
          </>
        )}
        {tab === "artifacts" && (
          <>
            <p className="muted association-hint">
              本会话保存的文件；点击查看内容或下载。
            </p>
            {artifacts.length === 0 ? (
              <p className="muted">暂无产物</p>
            ) : (
              artifacts.map((artifact) => (
                <button
                  type="button"
                  className="rail-row"
                  key={artifact.path}
                  title={artifact.path}
                  onClick={() => onOpenArtifact(artifact)}
                >
                  <span>{artifact.path.split("/").at(-1)}</span>
                  <small>
                    {artifact.kind} · {formatFileSize(artifact.size)}
                  </small>
                </button>
              ))
            )}
          </>
        )}
      </div>
    </aside>
  );
}
