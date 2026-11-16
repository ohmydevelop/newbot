import {
  ExpertIcon as UsersRound,
  PluginIcon as Blocks,
  SkillIcon as BookOpen,
} from "./AppIcons";
import { useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import {
  FileCode2,
  FolderOpen,
  SlidersHorizontal,
  Plus,
  X,
} from "lucide-react";
import { CapabilityRow } from "./CapabilityRow";
import type { Artifact, Thread } from "../../shared/types";
import { formatFileSize } from "../../shared/artifact-preview";
import { useMediaQuery } from "../media";

type RailTab = "associations" | "files" | "artifacts";

const tabs: { id: RailTab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: "associations", label: "会话能力", icon: SlidersHorizontal },
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
  expert,
  onExpert,
  onRemoveExpert,
  onAdd,
  canPickPlugins,
  canPickSkills,
  onRemove,
  onPickFiles,
  onOpenArtifact,
  onClose,
  restoreFocus,
  capabilityFocus,
}: {
  capabilityFocus?: { kind: "plugins" | "skills"; version: number } | null;
  thread?: Thread;
  busy: boolean;
  expert?: { id: string; name: string };
  onExpert: () => void;
  onRemoveExpert: () => void;
  onAdd: (kind: "plugins" | "skills") => void;
  canPickPlugins: boolean;
  canPickSkills: boolean;
  onRemove: (kind: "plugins" | "skills", id: string) => void;
  onPickFiles: () => void;
  onOpenArtifact: (artifact: Artifact) => void;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const stored = (): RailTab => {
    const value = localStorage.getItem("newbot:rail-tab");
    return tabs.some((t) => t.id === value)
      ? (value as RailTab)
      : "associations";
  };
  const [tab, setTab] = useState<RailTab>(stored);
  const panelId = useId();
  const pluginAdd = useRef<HTMLButtonElement>(null);
  const skillAdd = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (capabilityFocus) setTab("associations");
  }, [capabilityFocus]);
  useEffect(() => {
    if (!capabilityFocus || tab !== "associations") return;
    const frame = requestAnimationFrame(() => {
      const target =
        capabilityFocus.kind === "skills"
          ? skillAdd.current
          : pluginAdd.current;
      target?.scrollIntoView({ block: "nearest" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [capabilityFocus, tab]);
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
      Math.max(
        260,
        drag.current.startWidth - (event.clientX - drag.current.startX),
      ),
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
    name: x.displayName || x.name || "名称暂不可用",
  }));
  const skills = (thread?.nextInput?.skills || []).map((x) => ({
    id: x.id,
    name: x.displayName || x.name || "名称暂不可用",
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
  const content = (
    <>
      <div
        className="rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整右侧栏宽度"
        title="拖动调整宽度"
        tabIndex={narrow ? -1 : 0}
        aria-valuemin={260}
        aria-valuemax={520}
        aria-valuenow={width}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const next = Math.min(
            520,
            Math.max(260, width + (event.key === "ArrowLeft" ? 20 : -20)),
          );
          setWidth(next);
          localStorage.setItem("newbot:rail-width", String(next));
        }}
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
            id={`${panelId}-${t.id}`}
            aria-controls={panelId}
            tabIndex={tab === t.id ? 0 : -1}
            aria-selected={tab === t.id}
            className={`rail-tab ${tab === t.id ? "selected" : ""}`}
            title={t.label}
            onClick={() => setTab(t.id)}
            onKeyDown={(event) => {
              const index = tabs.findIndex((item) => item.id === tab);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(tabs[next].id);
              document.getElementById(`${panelId}-${tabs[next].id}`)?.focus();
            }}
          >
            <t.icon size={17} aria-hidden="true" />
            <span className="sr-only">{t.label}</span>
          </button>
        ))}
        <Dropdown.Root>
          <Dropdown.Trigger
            className="rail-tab rail-tab-add"
            title="添加面板"
            aria-label="添加面板"
          >
            <Plus size={16} aria-hidden="true" />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <ActionMenuContent
              className="dropdown"
              sideOffset={4}
              align="start"
            >
              {tabs.map((t) => (
                <ActionMenuItem
                  key={t.id}
                  icon={t.icon}
                  onSelect={() => setTab(t.id)}
                >
                  {t.label}
                </ActionMenuItem>
              ))}
            </ActionMenuContent>
          </Dropdown.Portal>
        </Dropdown.Root>
        <span className="rail-spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label="关闭右侧栏"
          title="关闭右侧栏"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div
        className="rail-body"
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${panelId}-${tab}`}
        aria-label={tabs.find((t) => t.id === tab)?.label}
      >
        <h2 className="rail-heading">
          {tabs.find((t) => t.id === tab)?.label}
        </h2>
        {tab === "associations" && (
          <>
            <p className="muted association-hint">用于本会话的后续消息。</p>
            <CapabilityRow
              items={[
                ...(expert
                  ? [
                      {
                        id: `expert:${expert.id}`,
                        content: (
                          <>
                            <button
                              type="button"
                              className="capability-label"
                              onClick={onExpert}
                            >
                              <UsersRound size={15} />
                              {expert.name}
                            </button>
                            <button
                              type="button"
                              aria-label="移除会话专家"
                              disabled={busy}
                              onClick={onRemoveExpert}
                            >
                              <X size={14} />
                            </button>
                          </>
                        ),
                      },
                    ]
                  : []),
                ...[
                  { kind: "plugins" as const, items: plugins, Icon: Blocks },
                  { kind: "skills" as const, items: skills, Icon: BookOpen },
                ].flatMap(({ kind, items, Icon }) =>
                  items.map((item) => ({
                    id: `${kind}:${item.id}`,
                    content: (
                      <>
                        <span className="capability-label" title={item.name}>
                          <Icon size={15} />
                          {item.name}
                        </span>
                        <button
                          type="button"
                          aria-label={`移除 ${item.name}`}
                          disabled={busy}
                          onClick={() => onRemove(kind, item.id)}
                        >
                          <X size={14} />
                        </button>
                      </>
                    ),
                  })),
                ),
              ]}
            />
            {!expert && !plugins.length && !skills.length && (
              <p className="muted">尚未选择能力</p>
            )}
            <div className="rail-capability-actions">
              {canPickPlugins && (
                <button
                  type="button"
                  disabled={busy}
                  ref={pluginAdd}
                  onClick={() => onAdd("plugins")}
                >
                  <Plus size={16} />
                  添加专家或插件
                </button>
              )}
              {canPickSkills && (
                <button
                  type="button"
                  disabled={busy}
                  ref={skillAdd}
                  onClick={() => onAdd("skills")}
                >
                  <Plus size={16} />
                  添加技能
                </button>
              )}
            </div>
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
    </>
  );
  if (!narrow)
    return (
      <aside
        className="rail"
        aria-label="右侧工作区"
        style={{ flexBasis: width, width }}
      >
        {content}
      </aside>
    );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="rail-scrim" />
        <Dialog.Content
          className="rail rail-overlay"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <Dialog.Title className="sr-only">右侧工作区</Dialog.Title>
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
