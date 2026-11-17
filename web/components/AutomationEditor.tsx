import { IncomingFields } from "./AutomationIncomingFields";
import {
  SubscriptionFields,
  useEventCatalog,
} from "./AutomationSubscriptionFields";
import { useRef, useState, useEffect, type ReactNode } from "react";
import { Plus, X, ArrowLeft, Bell } from "lucide-react";
import { dialogReturnTarget } from "./ui";
import { AddSchedule, ScheduleFields } from "./AutomationScheduleFields";
import { AutomationIconPicker } from "./AutomationIdentity";
import { FormActions, FormSubmit } from "./FormActions";
import AutomationMailSettings from "./AutomationMailSettings";
import { AutomationChoice } from "./AutomationChoice";
import { PluginIcon, SkillIcon } from "./AppIcons";
import { useComposerMentions } from "./ComposerMentions";
import { ApprovalChoice } from "./ApprovalChoice";
import type { ComposerPanel } from "./Picker";
import { request, useApp } from "../store";
import { responseJson } from "../http";
import { readSkill } from "../skills";
import { automationRequest } from "../automations";
import {
  notificationLabels,
  type AutomationInput,
  type AutomationSchedule,
  type Automation,
} from "../../shared/automations";
import type { Json } from "../../shared/types";
export function initialSchedule(): AutomationSchedule {
  return {
    id: crypto.randomUUID(),
    frequency: "daily",
    time: "08:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    date: new Date().toLocaleDateString("en-CA"),
    weekdays: [1],
  };
}
export function newAutomation(
  patch: Partial<AutomationInput> = {},
): AutomationInput {
  return {
    name: "",
    prompt: "",
    triggers: [],
    eventTriggers: [],
    provider: "",
    model: "",
    effort: "",
    mode: "chat",
    approval: "ask",
    attachments: [],
    plugins: [],
    skills: [],
    expertId: null,
    notification: "app",
    ...patch,
  };
}
export default function AutomationEditor({
  task,
  initial,
  onClose,
  onSaved,
}: {
  task?: Automation;
  initial?: Partial<AutomationInput>;
  onClose: () => void;
  onSaved: (task: Automation) => void;
}) {
  const [mailSettings, setMailSettings] = useState(false);
  const sources = useEventCatalog();
  const [draft, setDraft] = useState<AutomationInput>(
      () => task || newAutomation(initial),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [panel, setPanel] = useState<ComposerPanel>(null),
    [models, setModels] = useState<Json[]>([]),
    [labels, setLabels] = useState<Record<string, string>>({}),
    [files, setFiles] = useState<Record<string, string>>({}),
    [uploading, setUploading] = useState(false),
    [presets, setPresets] = useState<Json[]>([]);
  const id = useRef(task?.id || crypto.randomUUID()),
    posting = useRef(false),
    textarea = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const update = (next: Partial<AutomationInput>) =>
    setDraft((d) => ({ ...d, ...next }));
  useEffect(() => {
    let live = true;
    void Promise.all([
      request<Json[]>("gateway/catalog"),
      request<Json[]>("runtime/presets"),
      request<Json>("plugin/list"),
      request<Json>("expert/list"),
    ])
      .then(([m, p, plugins, experts]) => {
        if (!live) return;
        setModels(m);
        setPresets(p);
        setLabels(
          Object.fromEntries(
            [
              ...(plugins.entries || []),
              ...(experts.entries || []),
              ...(useApp.getState().settings?.skills || []),
            ].map((v) => [v.id, v.displayName || v.name]),
          ),
        );
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const mentions = useComposerMentions({
    value: draft.prompt,
    scope: id.current,
    disabled: busy || uploading,
    panel,
    setPanel,
    textarea,
    selectedSkills: draft.skills.map((v) => v.id),
    selectedPlugins: draft.plugins,
    selectedExpert: draft.expertId,
    onSelect: async (kind, entry, token, signal) => {
      let selection;
      if (kind === "$" && !draft.skills.some((v) => v.id === entry.id)) {
        const doc = await readSkill(entry.id, signal);
        selection = { id: entry.id, sha256: doc.sha256 };
      }
      if (signal.aborted) return;
      setLabels((v) => ({ ...v, [entry.id]: entry.displayName || entry.name }));
      setDraft((d) => ({
        ...d,
        ...(kind === "$"
          ? {
              skills: d.skills.some((v) => v.id === entry.id)
                ? d.skills.filter((v) => v.id !== entry.id)
                : [...d.skills, selection!],
            }
          : entry.kind === "expert"
            ? { expertId: d.expertId === entry.id ? null : entry.id }
            : {
                plugins: d.plugins.includes(entry.id)
                  ? d.plugins.filter((v) => v !== entry.id)
                  : [...d.plugins, entry.id],
              }),
        ...(token
          ? {
              prompt:
                d.prompt.slice(0, token.start) + d.prompt.slice(token.end),
            }
          : {}),
      }));
    },
  });
  async function upload(list: FileList | null) {
    if (!list || uploading || busy) return;
    if (list.length + draft.attachments.length > 8) {
      setError("最多添加 8 个附件");
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const f of Array.from(list)) {
        const r = await fetch(
          `/api/attachments?name=${encodeURIComponent(f.name)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: f,
          },
        );
        const data = await responseJson(r);
        if (!r.ok) throw Error(data.error || "上传失败");
        setFiles((v) => ({ ...v, [data.id]: data.name }));
        setDraft((v) => ({ ...v, attachments: [...v.attachments, data.id] }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function save() {
    if (posting.current || uploading) return;
    posting.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await automationRequest<Automation>("/save", {
        id: id.current,
        expectedRevision: task?.revision || 0,
        content: draft,
      });
      onSaved(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }
  const modelOptions = [
    { id: "", label: "默认模型" },
    ...models.flatMap((g) =>
      (g.models || []).map((m: Json) => ({
        id: `${g.id}::${m.model}`,
        label: `${m.displayName || m.model} · ${g.name}`,
      })),
    ),
  ];
  return (
    <EditorFrame
      title={task ? "编辑自动任务" : "新建自动任务"}
      busy={busy || uploading}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="automation-editor-body">
          <div className="automation-name-line">
            <AutomationIconPicker
              icon={draft.icon}
              color={draft.color}
              disabled={busy}
              onChange={update}
            />
            <input
              className="automation-name"
              aria-label="任务名称"
              placeholder="任务名称"
              maxLength={100}
              required
              data-autofocus
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              disabled={busy}
            />
          </div>
          <section className="automation-field">
            <h3>触发器</h3>
            {draft.triggers.map((t, index) => (
              <ScheduleFields
                key={t.id}
                value={t}
                index={index + 1}
                disabled={busy}
                onChange={(patch) =>
                  update({
                    triggers: draft.triggers.map((v) =>
                      v.id === t.id ? { ...v, ...patch } : v,
                    ),
                  })
                }
                onRemove={() =>
                  update({
                    triggers: draft.triggers.filter((v) => v.id !== t.id),
                  })
                }
              />
            ))}
            {draft.eventTriggers.map((t, index) =>
              t.source === "incoming" ? (
                <IncomingFields
                  key={t.id}
                  value={t}
                  disabled={busy}
                  onChange={(events) =>
                    update({
                      eventTriggers: draft.eventTriggers.map((v) =>
                        v.id === t.id ? { ...v, events } : v,
                      ),
                    })
                  }
                  onRemove={() =>
                    update({
                      eventTriggers: draft.eventTriggers.filter(
                        (v) => v.id !== t.id,
                      ),
                    })
                  }
                />
              ) : (
                <SubscriptionFields
                  key={t.id}
                  value={t}
                  index={index + 1}
                  disabled={busy}
                  catalog={sources.catalog}
                  refresh={sources.refresh}
                  onChange={(patch) =>
                    update({
                      eventTriggers: draft.eventTriggers.map((v) =>
                        v.id === t.id && v.source === "subscription"
                          ? { ...v, ...patch }
                          : v,
                      ),
                    })
                  }
                  onRemove={() =>
                    update({
                      eventTriggers: draft.eventTriggers.filter(
                        (v) => v.id !== t.id,
                      ),
                    })
                  }
                />
              ),
            )}
            <AddSchedule
              onIncoming={() =>
                update({
                  eventTriggers: [
                    ...draft.eventTriggers,
                    { id: crypto.randomUUID(), source: "incoming", events: [] },
                  ],
                })
              }
              sources={sources.catalog.providers}
              onSubscription={(providerId) =>
                update({
                  eventTriggers: [
                    ...draft.eventTriggers,
                    {
                      id: crypto.randomUUID(),
                      source: "subscription",
                      providerId,
                      connectionId: "",
                      events:
                        sources.catalog.providers
                          .find((p) => p.id === providerId)
                          ?.events.slice(0, 1)
                          .map((e) => e.id) || [],
                      arguments: {},
                    },
                  ],
                })
              }
              disabled={
                busy ||
                draft.triggers.length + (draft.eventTriggers?.length || 0) >= 8
              }
              onAdd={(frequency) =>
                update({
                  triggers: [
                    ...draft.triggers,
                    {
                      ...initialSchedule(),
                      frequency,
                      ...(frequency === "hourly"
                        ? { time: "09:00", until: "18:00", weekdays: [] }
                        : {}),
                    },
                  ],
                })
              }
            />
            {sources.error && (
              <p className="error" role="alert">
                {sources.error}
              </p>
            )}
          </section>
          <section className="automation-field">
            <h3>指令</h3>
            <div className="automation-prompt">
              <textarea
                ref={textarea}
                aria-label="任务指令"
                required
                placeholder="你希望 newbot 做什么？"
                value={draft.prompt}
                onChange={(e) => update({ prompt: e.target.value })}
                onKeyDown={mentions.onKeyDown}
                onClick={mentions.onCaretChange}
                onSelect={mentions.onCaretChange}
                disabled={busy}
              />
              <div className="automation-capabilities">
                <div
                  className="automation-tools"
                  role="group"
                  aria-label="任务工具"
                >
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="添加任务附件"
                    disabled={busy || uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Plus size={18} />
                  </button>
                  <button
                    type="button"
                    className="automation-capability"
                    aria-label={`连接器${draft.plugins.length || draft.expertId ? ` ${draft.plugins.length + (draft.expertId ? 1 : 0)}` : ""}`}
                    title="选择连接器或专家"
                    disabled={busy}
                    onClick={(e) => mentions.open("plugins", e.currentTarget)}
                  >
                    <PluginIcon size={18} />
                    <span className="automation-capability-label">
                      连接器
                      {draft.plugins.length || draft.expertId
                        ? ` ${draft.plugins.length + (draft.expertId ? 1 : 0)}`
                        : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="automation-capability"
                    aria-label={`技能${draft.skills.length ? ` ${draft.skills.length}` : ""}`}
                    title="选择技能"
                    disabled={busy}
                    onClick={(e) => mentions.open("skills", e.currentTarget)}
                  >
                    <SkillIcon size={18} />
                    <span className="automation-capability-label">
                      技能{draft.skills.length ? ` ${draft.skills.length}` : ""}
                    </span>
                  </button>
                </div>
                <div
                  className="automation-runtime"
                  role="group"
                  aria-label="任务模型与模式"
                >
                  <AutomationChoice
                    label="任务模型"
                    displayValue={draft.model || "默认"}
                    value={
                      draft.provider && draft.model
                        ? `${draft.provider}::${draft.model}`
                        : ""
                    }
                    options={modelOptions}
                    onChange={(v) => {
                      const [provider = "", model = ""] = v.split("::");
                      update({ provider, model });
                    }}
                    search
                    disabled={busy}
                  />
                  <ApprovalChoice
                    value={draft.approval}
                    mode={draft.mode}
                    onMode={(v) => update({ mode: v })}
                    open={panel === "approval"}
                    onOpenChange={(v) => setPanel(v ? "approval" : null)}
                    disabled={busy}
                    busy={false}
                    reading={false}
                    error=""
                    presets={presets.map((p) => ({
                      id: p.id,
                      allowed: p.allowed,
                      reason: p.reason,
                    }))}
                    onRetry={() => {}}
                    onChange={(v) => update({ approval: v })}
                  />
                </div>
              </div>
            </div>
            {mentions.menu}
            <input
              ref={fileInput}
              hidden
              type="file"
              multiple
              onChange={(e) => void upload(e.target.files)}
            />
            {uploading && <p role="status">正在上传…</p>}
            <div className="automation-chips">
              {[
                ...draft.plugins.map((id) => ({ id, kind: "plugins" })),
                ...draft.skills.map((v) => ({ id: v.id, kind: "skills" })),
                ...(draft.expertId
                  ? [{ id: draft.expertId, kind: "expert" }]
                  : []),
                ...draft.attachments.map((id) => ({ id, kind: "attachments" })),
              ].map((v) => (
                <button
                  type="button"
                  key={v.kind + v.id}
                  disabled={busy}
                  title={labels[v.id] || files[v.id] || "已保存附件"}
                  onClick={() =>
                    update(
                      v.kind === "plugins"
                        ? { plugins: draft.plugins.filter((id) => id !== v.id) }
                        : v.kind === "skills"
                          ? {
                              skills: draft.skills.filter((s) => s.id !== v.id),
                            }
                          : v.kind === "expert"
                            ? { expertId: null }
                            : {
                                attachments: draft.attachments.filter(
                                  (id) => id !== v.id,
                                ),
                              },
                    )
                  }
                >
                  {labels[v.id] ||
                    files[v.id] ||
                    (v.kind === "attachments" ? "附件" : "已选扩展")}
                  <X size={13} />
                </button>
              ))}
            </div>
          </section>
          <section className="automation-field">
            <h3>通知</h3>
            <div className="automation-schedule-line">
              <Bell size={18} />
              <AutomationChoice
                label="任务通知"
                value={draft.notification}
                options={Object.entries(notificationLabels).map(
                  ([id, label]) => ({ id, label }),
                )}
                onChange={(v) =>
                  update({ notification: v as AutomationInput["notification"] })
                }
                disabled={busy}
              />
            </div>
            {["email", "both"].includes(draft.notification) && (
              <button
                type="button"
                className="automation-add-trigger"
                onClick={() => setMailSettings(true)}
              >
                配置邮件
              </button>
            )}
          </section>
        </div>
        <div className="automation-editor-footer">
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <FormActions>
            <button
              type="button"
              disabled={busy || uploading}
              onClick={onClose}
            >
              取消
            </button>
            <FormSubmit
              busy={busy}
              disabled={
                uploading ||
                !(draft.triggers.length + (draft.eventTriggers?.length || 0))
              }
              busyLabel="正在保存…"
            >
              保存
            </FormSubmit>
          </FormActions>
        </div>
      </form>
      {mailSettings && (
        <AutomationMailSettings onClose={() => setMailSettings(false)} />
      )}
    </EditorFrame>
  );
}

function EditorFrame({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  const returnTarget = useRef<HTMLElement | null>(dialogReturnTarget());
  useEffect(() => {
    frame.current
      ?.querySelector<HTMLElement>("[data-autofocus]")
      ?.focus({ preventScroll: true });
    const target = returnTarget.current;
    return () => {
      requestAnimationFrame(() => {
        if (target?.isConnected && target.getClientRects().length)
          target.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <section
      ref={frame}
      className="automation-editor automation-editor-inline"
      aria-label={title}
      onKeyDown={(e) => {
        if (
          e.key !== "Escape" ||
          e.defaultPrevented ||
          busy ||
          document.querySelector(
            '[data-state="open"][role="dialog"], [role="menu"][data-state="open"]',
          )
        )
          return;
        e.preventDefault();
        onClose();
      }}
    >
      <header className="automation-editor-header">
        <button
          type="button"
          className="icon-button"
          aria-label="返回自动任务"
          disabled={busy}
          onClick={onClose}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="muted">自动任务</span>
        <span className="muted" aria-hidden="true">
          /
        </span>
        <h1>{title}</h1>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </section>
  );
}
