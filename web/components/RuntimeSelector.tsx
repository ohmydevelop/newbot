import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Slider from "@radix-ui/react-slider";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Shield,
  ShieldAlert,
  X,
} from "lucide-react";
import type { Json } from "../../shared/types";
import {
  approvalLabels,
  type ApprovalPreset,
  type SessionRuntime,
} from "../../shared/runtime-settings";
import { useApp, request } from "../store";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import { PickerContent, type ComposerPanel, type PanelSetter } from "./Picker";
const efforts: Record<string, string> = {
  none: "关闭",
  minimal: "极简",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "Max",
  ultra: "Ultra",
};
const orderedEfforts = Object.keys(efforts);
export default function RuntimeSelector({
  disabled,
  newApproval,
  onApproval,
  panel,
  setPanel,
}: {
  disabled: boolean;
  newApproval: ApprovalPreset;
  onApproval: (value: ApprovalPreset) => void;
  panel: ComposerPanel;
  setPanel: PanelSetter;
}) {
  const s = useApp(),
    [entries, setEntries] = useState<Json[]>([]),
    [presets, setPresets] = useState<Json[]>([]),
    [query, setQuery] = useState(""),
    [reading, setReading] = useState(false),
    [mutating, setMutating] = useState(false),
    [error, setError] = useState(""),
    [presetError, setPresetError] = useState(""),
    [presetReading, setPresetReading] = useState(false),
    [preview, setPreview] = useState<number | null>(null);
  const search = useRef<HTMLInputElement>(null),
    catalogGeneration = useRef(0),
    presetGeneration = useRef(0),
    posting = useRef(false);
  const approval = s.thread?.runtime?.approval || newApproval;
  async function read(refresh = false) {
    const version = ++catalogGeneration.current;
    setReading(true);
    setError("");
    try {
      const result = await request<Json[]>("gateway/catalog", { refresh });
      if (version === catalogGeneration.current) setEntries(result);
    } catch (e) {
      if (version === catalogGeneration.current)
        setError(e instanceof Error ? e.message : "目录读取失败");
    } finally {
      if (version === catalogGeneration.current) setReading(false);
    }
  }
  async function readPresets() {
    const version = ++presetGeneration.current;
    setPresetReading(true);
    setPresetError("");
    try {
      const result = await request<Json[]>("runtime/presets", {
        model: s.model || undefined,
      });
      if (version === presetGeneration.current) setPresets(result);
    } catch (e) {
      if (version === presetGeneration.current)
        setPresetError(e instanceof Error ? e.message : "审批配置读取失败");
    } finally {
      if (version === presetGeneration.current) setPresetReading(false);
    }
  }
  useEffect(() => {
    if (panel === "runtime") {
      setQuery("");
      void read();
    } else {
      catalogGeneration.current++;
      setReading(false);
      setPreview(null);
    }
    if (panel === "approval") void readPresets();
    else {
      presetGeneration.current++;
      setPresetReading(false);
    }
  }, [panel]);
  useEffect(() => {
    if (disabled)
      setPanel((p) => (p === "runtime" || p === "approval" ? null : p));
  }, [disabled]);
  useEffect(() => {
    setPreview(null);
  }, [s.model, s.provider, s.effort, s.selectedId]);
  useEffect(
    () => () => {
      catalogGeneration.current++;
      presetGeneration.current++;
    },
    [],
  );
  async function update(patch: Json) {
    if (disabled || posting.current) return;
    const threadId = s.selectedId;
    posting.current = true;
    setMutating(true);
    setError("");
    setPresetError("");
    try {
      if (threadId) {
        const runtime = await request<SessionRuntime>("session/update", {
          threadId,
          expectedRevision: s.thread?.runtime?.revision || 0,
          ...patch,
        });
        useApp.setState((state) => {
          if (
            state.selectedId !== threadId ||
            state.thread?.id !== threadId ||
            (state.thread.runtime?.revision || 0) > runtime.revision
          )
            return {};
          return {
            thread: {
              ...state.thread,
              runtime,
              modelProvider: runtime.provider,
            },
            provider: runtime.provider,
            model: runtime.model,
            effort: runtime.effort,
            threads: state.threads.map((thread) =>
              thread.id === threadId
                ? { ...thread, provider: runtime.provider }
                : thread,
            ),
          };
        });
      } else if (!useApp.getState().selectedId) {
        s.set(patch);
        if (patch.approval) onApproval(patch.approval);
      }
    } catch (e) {
      if (useApp.getState().selectedId === threadId) {
        const message = e instanceof Error ? e.message : "设置未保存，请重试";
        if (patch.approval) {
          setPresetError(message);
          s.notify(e);
        } else setError(message);
      }
    } finally {
      posting.current = false;
      setMutating(false);
      setPreview(null);
    }
  }
  const selected =
    entries
      .find((g) => g.id === s.provider)
      ?.models.find((m: Json) => m.model === s.model) ||
    s.settings?.models.find((m: Json) => m.model === s.model);
  const supported: Json[] = selected?.supportedReasoningEfforts || [];
  const known = supported
    .filter((e) => orderedEfforts.includes(e.reasoningEffort))
    .sort(
      (a, b) =>
        orderedEfforts.indexOf(a.reasoningEffort) -
        orderedEfforts.indexOf(b.reasoningEffort),
    );
  const other = supported.filter(
    (e) => !orderedEfforts.includes(e.reasoningEffort),
  );
  const actualIndex = known.findIndex(
    (e) => e.reasoningEffort === (s.effort || selected?.defaultReasoningEffort),
  );
  const step = preview ?? Math.max(0, actualIndex),
    shownEffort = preview === null ? s.effort : known[step]?.reasoningEffort;
  function modelKeys(
    event: React.KeyboardEvent<HTMLElement>,
    fromSearch = false,
  ) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (fromSearch && event.key !== "ArrowDown") return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(
      event.currentTarget
        .closest(".runtime-panel")
        ?.querySelectorAll<HTMLButtonElement>(".model-option:not(:disabled)") ||
        [],
    );
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(event.currentTarget as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length;
    options[next].focus();
  }
  const filter = query.trim().toLowerCase();
  const groups: Json[] = entries
    .map(
      (gateway, index): Json => ({
        ...gateway,
        index,
        matches: gateway.models.filter((m: Json) =>
          `${gateway.name} ${m.model} ${m.displayName}`
            .toLowerCase()
            .includes(filter),
        ),
      }),
    )
    .filter((g) => !filter || g.matches.length);
  return (
    <div className="runtime-selectors">
      <Popover.Root
        open={panel === "runtime" && !disabled}
        onOpenChange={(open) =>
          setPanel((p) => (open ? "runtime" : p === "runtime" ? null : p))
        }
      >
        <Popover.Trigger
          type="button"
          className="runtime-picker-trigger"
          disabled={disabled}
          aria-label="选择模型与推理强度"
          title="选择模型与推理强度"
        >
          <span>{selected?.displayName || s.model || "选择模型"}</span>
          {s.effort && <small>{efforts[s.effort] || s.effort}</small>}
          <ChevronDown size={14} aria-hidden="true" />
        </Popover.Trigger>
        <PickerContent
          className="runtime-panel"
          align="end"
          side="top"
          aria-label="选择模型与推理强度"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            search.current?.focus();
          }}
          onEscapeKeyDown={() => setPreview(null)}
        >
          <div className="picker-search">
            <input
              ref={search}
              type="search"
              aria-label="搜索网关或模型"
              placeholder="搜索网关或模型"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => modelKeys(e, true)}
            />
            <button
              type="button"
              className="icon-button"
              title="刷新模型目录"
              aria-label="刷新模型目录"
              disabled={reading || mutating}
              onClick={() => void read(true)}
            >
              <RefreshCw
                size={17}
                className={reading ? "spin" : ""}
                aria-hidden="true"
              />
            </button>
            <Popover.Close
              type="button"
              className="icon-button"
              title="关闭"
              aria-label="关闭模型选择器"
            >
              <X size={17} aria-hidden="true" />
            </Popover.Close>
          </div>
          <div className="picker-feedback" aria-live="polite">
            {reading && <p role="status">正在读取模型目录…</p>}
            {error && (
              <p role="alert" className="inline-error">
                {error}
                <button type="button" onClick={() => void read(true)}>
                  重试
                </button>
              </p>
            )}
          </div>
          <div className="model-catalog" aria-busy={reading || mutating}>
            {groups.map((g) => {
              const expanded =
                !!filter ||
                !(
                  s.gatewayCollapsed[g.id] ??
                  (s.provider ? g.id !== s.provider : g.index !== 0)
                );
              return (
                <section className="model-group" key={g.id}>
                  <button
                    type="button"
                    className="model-group-heading"
                    aria-expanded={expanded}
                    aria-label={`${g.name} 模型分组`}
                    disabled={!!filter}
                    onClick={() =>
                      s.set({
                        gatewayCollapsed: {
                          ...s.gatewayCollapsed,
                          [g.id]: expanded,
                        },
                      })
                    }
                  >
                    {expanded ? (
                      <ChevronDown size={16} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={16} aria-hidden="true" />
                    )}
                    <strong>{g.name}</strong>
                    <span>{g.matches.length}</span>
                  </button>
                  {expanded && (
                    <div role="listbox" aria-label={`${g.name} 模型`}>
                      {(g.error || g.profileError) && (
                        <p className="menu-empty" role="status">
                          {g.error || g.profileError}
                        </p>
                      )}
                      {g.matches.map((m: Json) => (
                        <button
                          key={m.model}
                          type="button"
                          role="option"
                          aria-selected={
                            s.provider === g.id && s.model === m.model
                          }
                          className="model-option"
                          onKeyDown={(e) => modelKeys(e)}
                          disabled={mutating || reading}
                          onClick={() =>
                            void update({
                              provider: g.id,
                              model: m.model,
                              effort: m.defaultReasoningEffort || "",
                            })
                          }
                        >
                          <span title={m.displayName}>{m.displayName}</span>
                          {s.provider === g.id && s.model === m.model && (
                            <Check size={17} aria-hidden="true" />
                          )}
                        </button>
                      ))}
                      {!g.matches.length && !g.error && !g.profileError && (
                        <p className="menu-empty">此网关暂未提供模型</p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
            {!reading && !groups.length && (
              <p className="menu-empty">
                {filter ? "没有匹配的模型" : "没有可用的模型网关"}
              </p>
            )}
          </div>
          <section className="reasoning-picker" aria-label="推理强度">
            <header>
              <span>推理强度</span>
              <strong>
                {shownEffort ? efforts[shownEffort] || shownEffort : "默认"}
              </strong>
              <button
                type="button"
                className="icon-button"
                aria-label="恢复模型默认推理强度"
                title="使用模型默认推理强度"
                disabled={mutating || reading || !supported.length}
                onClick={() =>
                  void update({
                    effort: selected?.defaultReasoningEffort || "",
                  })
                }
              >
                <RotateCcw size={15} aria-hidden="true" />
              </button>
            </header>
            {known.length > 1 ? (
              <>
                <Slider.Root
                  className="reasoning-slider"
                  value={[step]}
                  min={0}
                  max={known.length - 1}
                  step={1}
                  disabled={mutating || reading}
                  onValueChange={([v]) => setPreview(v)}
                  onValueCommit={([v]) => {
                    if (known[v]?.reasoningEffort !== s.effort)
                      void update({ effort: known[v].reasoningEffort });
                    else setPreview(null);
                  }}
                >
                  <Slider.Track className="reasoning-track">
                    <Slider.Range className="reasoning-range" />
                    {known.map((e, i) => (
                      <span
                        key={e.reasoningEffort}
                        className="reasoning-tick"
                        style={{ left: `${(i / (known.length - 1)) * 100}%` }}
                      />
                    ))}
                  </Slider.Track>
                  <Slider.Thumb
                    className="reasoning-thumb"
                    aria-label="推理强度"
                    aria-valuetext={
                      efforts[known[step]?.reasoningEffort] || "默认"
                    }
                  />
                </Slider.Root>
                <div className="reasoning-labels">
                  {known.map((e, i) => (
                    <button
                      key={e.reasoningEffort}
                      type="button"
                      title={e.description || efforts[e.reasoningEffort]}
                      aria-label={`推理强度：${efforts[e.reasoningEffort]}`}
                      aria-pressed={i === actualIndex}
                      disabled={mutating || reading}
                      onClick={() => void update({ effort: e.reasoningEffort })}
                    >
                      {efforts[e.reasoningEffort]}
                    </button>
                  ))}
                </div>
              </>
            ) : known.length === 1 ? (
              <p className="picker-note">
                此模型支持：{efforts[known[0].reasoningEffort]}
              </p>
            ) : !other.length ? (
              <p className="picker-note">此模型未提供可配置的推理档位</p>
            ) : null}
            {other.length > 0 && (
              <div className="reasoning-other">
                {other.map((e) => (
                  <button
                    type="button"
                    className="secondary"
                    key={e.reasoningEffort}
                    disabled={mutating || reading}
                    aria-pressed={s.effort === e.reasoningEffort}
                    onClick={() => void update({ effort: e.reasoningEffort })}
                  >
                    {e.reasoningEffort}
                  </button>
                ))}
              </div>
            )}
            {mutating && (
              <p role="status" className="picker-note">
                正在保存设置…
              </p>
            )}
          </section>
        </PickerContent>
      </Popover.Root>
      <Dropdown.Root
        open={panel === "approval" && !disabled}
        onOpenChange={(open) =>
          setPanel((p) => (open ? "approval" : p === "approval" ? null : p))
        }
      >
        <Dropdown.Trigger
          type="button"
          className="icon-button"
          disabled={disabled || mutating}
          aria-label={`会话审批：${approvalLabels[approval]}`}
          title={approvalLabels[approval]}
        >
          <ShieldCheck size={18} aria-hidden="true" />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <ActionMenuContent>
            <Dropdown.Label className="action-menu-heading">
              会话审批
            </Dropdown.Label>
            {presetReading && (
              <p className="menu-empty" role="status">
                正在读取…
              </p>
            )}
            {presetError && (
              <div className="menu-empty" role="alert">
                {presetError}
                <button type="button" onClick={() => void readPresets()}>
                  重试
                </button>
              </div>
            )}
            {presets.map((p) => (
              <ActionMenuItem
                key={p.id}
                icon={
                  p.id === "full"
                    ? ShieldAlert
                    : p.id === "review"
                      ? ShieldCheck
                      : Shield
                }
                disabled={!p.allowed || mutating || presetReading}
                title={p.reason || undefined}
                description={p.reason || undefined}
                trailing={approval === p.id ? <Check size={16} /> : undefined}
                onSelect={() => void update({ approval: p.id })}
              >
                {approvalLabels[p.id as ApprovalPreset]}
              </ActionMenuItem>
            ))}
          </ActionMenuContent>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
