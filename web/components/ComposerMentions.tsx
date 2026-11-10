import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, RefreshCw, X } from "lucide-react";
import type { Json } from "../../shared/types";
import { skillLabel } from "../../shared/skills";
import { request, loadSettings, useApp } from "../store";
import { mentionAt, type MentionToken } from "../composer-selection";
import { PickerContent, type ComposerPanel, type PanelSetter } from "./Picker";

export function useComposerMentions({
  value,
  scope,
  disabled,
  panel,
  setPanel,
  textarea,
  selectedSkills,
  selectedPlugins,
  onSelect,
}: {
  value: string;
  scope: string;
  disabled: boolean;
  panel: ComposerPanel;
  setPanel: PanelSetter;
  textarea: RefObject<HTMLTextAreaElement | null>;
  selectedSkills: string[];
  selectedPlugins: string[];
  onSelect: (
    kind: "$" | "@",
    entry: Json,
    token: MentionToken | null,
    signal: AbortSignal,
  ) => Promise<void>;
}) {
  const skills = useApp((s) => s.settings?.skills),
    skillSelection = useApp((s) => s.skillSelection),
    pluginSelection = useApp((s) => s.pluginSelection);
  const [plugins, setPlugins] = useState<Json[]>([]),
    [mode, setMode] = useState<"button" | "mention">("button"),
    [search, setSearch] = useState(""),
    [caret, setCaret] = useState([0, 0]),
    [dismissed, setDismissed] = useState(""),
    [index, setIndex] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [selecting, setSelecting] = useState(false),
    [reload, setReload] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null),
    opener = useRef<HTMLElement | null>(null),
    pending = useRef<AbortController | null>(null),
    outside = useRef(false);
  const tokenSource = useRef<MentionToken | null>(null);
  const id = useId(),
    token = mentionAt(value, caret[0], caret[1]);
  const signature = `${scope}:${value}:${caret.join(":")}`;
  const active = panel === "plugins" || panel === "skills",
    kind = panel === "skills" ? "$" : "@";
  const query = mode === "mention" ? token?.query || "" : search;
  const allowed =
    (kind === "$" ? skillSelection : pluginSelection) && !disabled;
  const current = useRef({ scope, panel, value, signature });
  current.current = { scope, panel, value, signature };
  function close(fromOutside = false) {
    outside.current = fromOutside;
    pending.current?.abort();
    setDismissed(current.current.signature);
    setPanel((p) => (p === "plugins" || p === "skills" ? null : p));
  }
  function open(next: "plugins" | "skills", target?: HTMLElement | null) {
    if (disabled || !(next === "skills" ? skillSelection : pluginSelection))
      return;
    if (panel === next && mode === "button") {
      searchInput.current?.focus();
      return;
    }
    pending.current?.abort();
    opener.current = target || textarea.current;
    outside.current = false;
    tokenSource.current = null;
    setMode("button");
    setSearch("");
    setError("");
    setPanel(next);
  }
  function onCaretChange() {
    const el = textarea.current;
    if (el) setCaret([el.selectionStart, el.selectionEnd]);
  }
  useEffect(() => {
    pending.current?.abort();
    setSelecting(false);
    if (disabled) {
      if (active) close(true);
      return;
    }
    if (mode === "button" && active) return;
    if (
      token &&
      signature !== dismissed &&
      (token.kind === "$" ? skillSelection : pluginSelection)
    ) {
      opener.current = textarea.current;
      outside.current = false;
      tokenSource.current = token;
      setMode("mention");
      setPanel(token.kind === "$" ? "skills" : "plugins");
    } else if (mode === "mention" && active) close(true);
  }, [value, caret[0], caret[1], disabled, skillSelection, pluginSelection]);
  useEffect(() => {
    pending.current?.abort();
    setSelecting(false);
    setSearch("");
    setError("");
    setMode("button");
    setPanel((p) => (p === "plugins" || p === "skills" ? null : p));
  }, [scope]);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    pending.current?.abort();
    setSelecting(false);
    setIndex(0);
    setError("");
    if (!active) return;
    let live = true;
    setLoading(true);
    const read =
      kind === "@"
        ? request<Json>("plugin/list").then((v) => {
            if (!live) return;
            setPlugins(v.entries || []);
            if (!v.available) setError(v.reason || "插件目录不可用");
          })
        : reload
          ? loadSettings()
          : Promise.resolve();
    void read
      .catch(() => {
        if (live) setError("目录读取失败，请重试");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      pending.current?.abort();
    };
  }, [active, kind, scope, reload]);
  useEffect(() => {
    setIndex(0);
  }, [query]);
  const entries: Json[] = (
    kind === "$"
      ? (skills || [])
          .filter((s: Json) => mode === "button" || s.enabled)
          .map((s: Json) => ({
            ...s,
            displayName: skillLabel({ name: s.name, interface: s.interface }),
          }))
      : plugins.filter((p) => p.installed && p.enabled && p.available)
  ).filter((entry: Json) =>
    `${entry.name} ${entry.displayName} ${entry.description || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const selected = kind === "$" ? selectedSkills : selectedPlugins;
  async function select(entry: Json) {
    if (
      selecting ||
      loading ||
      !allowed ||
      (kind === "$" && entry.enabled === false)
    )
      return;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    const context = current.current,
      completion = tokenSource.current;
    setSelecting(true);
    setError("");
    try {
      await onSelect(kind, entry, completion, controller.signal);
      if (
        controller.signal.aborted ||
        current.current.scope !== context.scope ||
        current.current.panel !== context.panel
      )
        return;
      if (completion) {
        close();
        textarea.current?.focus();
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error && ["AbortError", "TimeoutError"].includes(e.name)
            ? "读取已取消或超时，请重试"
            : e instanceof Error
              ? e.message
              : "选择失败，请重试",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setSelecting(false);
      }
    }
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    if (!active || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (e.key === "Escape") {
      close();
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(
        (v) =>
          (v + (e.key === "ArrowDown" ? 1 : -1) + Math.max(1, entries.length)) %
          Math.max(1, entries.length),
      );
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (entries[index]) void select(entries[index]);
      return true;
    }
    return false;
  }
  useEffect(() => {
    document
      .getElementById(`${id}-${index}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index, id]);
  const menu = (
    <Popover.Root
      open={active && allowed}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Popover.Anchor asChild>
        <span className="composer-picker-anchor" />
      </Popover.Anchor>
      <PickerContent
        className="composer-selection-panel"
        align="start"
        side="top"
        aria-label={kind === "$" ? "选择技能" : "选择插件"}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (mode === "button") searchInput.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const focused = document.activeElement;
          const restoring =
            !focused ||
            focused === document.body ||
            focused === searchInput.current ||
            focused.closest(".composer-selection-panel");
          if (
            !outside.current &&
            !current.current.panel &&
            restoring &&
            opener.current?.isConnected
          )
            opener.current.focus({ preventScroll: true });
        }}
        onInteractOutside={(e) => {
          const target = e.target instanceof Element ? e.target : null;
          if (target?.closest("[data-composer-picker]")) {
            e.preventDefault();
            return;
          }
          if (mode === "mention" && e.target === textarea.current)
            e.preventDefault();
          else {
            outside.current = true;
            close(true);
          }
        }}
      >
        <div className="picker-search">
          <input
            ref={searchInput}
            type="search"
            aria-label={kind === "$" ? "搜索技能" : "搜索插件"}
            placeholder={kind === "$" ? "搜索技能" : "搜索插件"}
            value={query}
            role="combobox"
            aria-expanded
            aria-controls={id}
            aria-activedescendant={
              entries[index] ? `${id}-${index}` : undefined
            }
            aria-autocomplete="list"
            onChange={(e) => {
              pending.current?.abort();
              setSelecting(false);
              setMode("button");
              setSearch(e.target.value);
            }}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="刷新选择目录"
            title="刷新"
            disabled={loading || selecting}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw
              size={17}
              className={loading ? "spin" : ""}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭选择器"
            title="关闭"
            onClick={() => close()}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="picker-feedback" aria-live="polite">
          {loading && <p role="status">正在读取…</p>}
          {error && (
            <p role="alert" className="inline-error">
              {error}
              <button type="button" onClick={() => setReload((n) => n + 1)}>
                重试
              </button>
            </p>
          )}
          {!entries.length && !loading && !error && (
            <p>
              {query
                ? "没有匹配的结果"
                : "没有可用的" + (kind === "$" ? "技能" : "插件")}
            </p>
          )}
        </div>
        <div
          id={id}
          className="picker-results"
          role="listbox"
          aria-label={kind === "$" ? "可选技能" : "可选插件"}
          aria-multiselectable={mode === "button"}
          aria-busy={loading || selecting}
        >
          {entries.map((entry, i) => (
            <button
              id={`${id}-${i}`}
              key={entry.id}
              type="button"
              role="option"
              aria-selected={selected.includes(entry.id)}
              data-active={index === i || undefined}
              disabled={
                selecting ||
                loading ||
                (kind === "$" && entry.enabled === false) ||
                (!selected.includes(entry.id) && selected.length >= 8)
              }
              onMouseDown={(e) => e.preventDefault()}
              onPointerMove={() => setIndex(i)}
              onClick={() => void select(entry)}
            >
              <span>
                <strong>{entry.displayName || entry.name}</strong>
                <small>
                  {entry.name}
                  {entry.enabled === false ? " · 已停用" : ""}
                </small>
              </span>
              {selected.includes(entry.id) && (
                <Check size={17} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <footer className="picker-footer">
          <span>已选择 {selected.length} / 8</span>
          <button type="button" className="text-button" onClick={() => close()}>
            完成
          </button>
        </footer>
      </PickerContent>
    </Popover.Root>
  );
  return {
    menu,
    onKeyDown,
    onCaretChange,
    open,
    close,
    active,
    listId: id,
    activeId: entries[index] ? `${id}-${index}` : undefined,
  };
}
