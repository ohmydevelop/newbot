import {
  MoreIcon as MoreHorizontal,
  NavChevronIcon as ChevronDown,
  SearchIcon as Search,
} from "./ReferenceIcons";
import { PluginIcon as Blocks, NewChatIcon as SquarePen } from "./AppIcons";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Archive, Pencil, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { SidebarIcon } from "./SidebarIcon";
import type { ThreadSummary } from "../../shared/types";
import { absoluteTime, relativeTime } from "../time";
import { Sidebar } from "./Sidebar";
import { Mark } from "./ui";
import { ReadIndicator } from "./ReadIndicator";
import ThreadStatus from "./ThreadStatus";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";

type NavigationProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
  threads: ThreadSummary[];
  selectedId: string | null;
  loading: boolean;
  error: string;
  archiving: string | null;
  appleKeys: boolean;
  onNewChat: () => void;
  onSearch: () => void;
  onReload: () => void;
  onSettings: (tab: string) => void;
  onSelect: (id: string) => void;
  onRename: (thread: { id: string; name: string }) => void;
  onArchive: (id: string) => void;
};

export function ConversationNavigation({
  open,
  onOpenChange,
  restoreFocus,
  threads,
  selectedId,
  loading,
  error,
  archiving,
  appleKeys,
  onNewChat,
  onSearch,
  onReload,
  onSettings,
  onSelect,
  onRename,
  onArchive,
}: NavigationProps) {
  const [historyOpen, setHistoryOpen] = useState(true);
  const historyId = useId();
  const navigation = useRef<HTMLDivElement>(null);
  const focusToggle = useRef(false);
  function toggle(next: boolean) {
    focusToggle.current = window.innerWidth > 760;
    onOpenChange(next);
  }
  useEffect(() => {
    if (!focusToggle.current) return;
    focusToggle.current = false;
    navigation.current
      ?.querySelector<HTMLButtonElement>(
        open ? ".sidebar-toggle" : ".rail-toggle-navigation",
      )
      ?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div ref={navigation} className="navigation-slot" data-open={open}>
      {!open && (
        <aside className="sidebar-rail" aria-label="对话导航">
          <button
            type="button"
            className="rail-icon rail-toggle-navigation"
            aria-expanded={false}
            aria-label="展开侧栏"
            title="展开侧栏"
            onClick={() => toggle(true)}
          >
            <SidebarIcon />
          </button>
          <button
            type="button"
            className="rail-icon"
            aria-label="搜索聊天"
            title="搜索聊天"
            onClick={() => onSearch()}
          >
            <Search size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rail-icon"
            aria-label="新建聊天"
            title="新建聊天"
            onClick={onNewChat}
          >
            <SquarePen size={18} aria-hidden="true" />
          </button>
          <span className="rail-spacer" />
          <button
            type="button"
            className="rail-icon"
            aria-label="插件"
            title="插件"
            onClick={() => onSettings("plugins")}
          >
            <Blocks size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rail-icon rail-avatar"
            aria-label="设置"
            title="设置"
            onClick={() => onSettings("general")}
          >
            <Mark size={21} />
          </button>
        </aside>
      )}
      <Sidebar
        open={open}
        onOpenChange={onOpenChange}
        restoreFocus={restoreFocus}
      >
        <div className="sidebar-top">
          <button
            className="brand-button"
            onClick={onNewChat}
            aria-label="newbot 首页"
          >
            <Mark size={26} />
            <span>newbot</span>
          </button>
          <button
            className="icon-button sidebar-toggle"
            title="收起侧栏"
            aria-label="收起侧栏"
            aria-expanded={true}
            onClick={() => toggle(false)}
          >
            <SidebarIcon />
          </button>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <button onClick={onSearch}>
            <Search size={18} aria-hidden="true" />
            <span>搜索聊天</span>
            <kbd>{appleKeys ? "⌘ K" : "Ctrl K"}</kbd>
          </button>
          <button onClick={onNewChat}>
            <SquarePen size={18} />
            <span>新建聊天</span>
            <kbd>{appleKeys ? "⇧ ⌘ O" : "Ctrl ⇧ O"}</kbd>
          </button>
        </nav>
        <div className="history">
          <div className="history-heading">
            <h2>
              <button
                className="history-disclosure"
                aria-expanded={historyOpen}
                aria-controls={historyId}
                onClick={() => setHistoryOpen(!historyOpen)}
              >
                <span>最近对话</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </h2>
            <ReadIndicator
              busy={loading}
              error={error}
              label="正在读取对话"
              onRetry={() => onReload()}
            />
          </div>
          <span className="sr-only" role="alert">
            {error}
          </span>
          <div id={historyId} hidden={!historyOpen}>
            {threads.length === 0 && !loading && !error ? (
              <p className="history-empty">新的想法，从这里开始。</p>
            ) : (
              threads.map((t) => (
                <div
                  className={`history-row ${selectedId === t.id ? "selected" : ""}`}
                  key={t.id}
                  data-thread-id={t.id}
                >
                  <button
                    className="history-link"
                    onClick={() => onSelect(t.id)}
                    title={t.title}
                    aria-current={selectedId === t.id ? "page" : undefined}
                  >
                    <span className="history-title">{t.title}</span>
                    <time
                      className="history-time"
                      dateTime={new Date(t.updated).toISOString()}
                      title={absoluteTime(t.updated)}
                    >
                      {relativeTime(t.updated)}
                    </time>
                  </button>
                  <div className="history-actions">
                    <ThreadStatus activity={t.activity} />
                    <Dropdown.Root>
                      <Dropdown.Trigger
                        className="icon-button history-more"
                        aria-label={`更多操作：${t.title}`}
                      >
                        <MoreHorizontal size={14} />
                      </Dropdown.Trigger>
                      <Dropdown.Portal>
                        <ActionMenuContent
                          className="dropdown"
                          sideOffset={4}
                          align="start"
                        >
                          <ActionMenuItem
                            icon={Pencil}
                            onSelect={() =>
                              onRename({ id: t.id, name: t.title })
                            }
                          >
                            重命名
                          </ActionMenuItem>
                          <ActionMenuItem
                            icon={Archive}
                            disabled={!!archiving}
                            onSelect={() => onArchive(t.id)}
                          >
                            {archiving === t.id ? "正在归档…" : "归档"}
                          </ActionMenuItem>
                        </ActionMenuContent>
                      </Dropdown.Portal>
                    </Dropdown.Root>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            type="button"
            className="sidebar-plugins"
            onClick={() => onSettings("plugins")}
          >
            <Blocks size={18} aria-hidden="true" />
            <span>插件</span>
          </button>
          <button
            className="account-button"
            aria-label="设置"
            onClick={() => onSettings("general")}
          >
            <span className="avatar">
              <Mark size={21} />
            </span>
            <span>
              <strong>个人工作台</strong>
              <small>私有实例</small>
            </span>
            <SettingsIcon size={18} />
          </button>
        </div>
      </Sidebar>
    </div>
  );
}
