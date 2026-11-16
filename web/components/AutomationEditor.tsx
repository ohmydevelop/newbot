import { useRef, useState, useEffect } from "react";
import { Plus, X, Paperclip, Clock3, Bell } from "lucide-react";
import { Modal } from "./ui";
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
  frequencyLabels,
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
    triggers: [initialSchedule()],
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
  const timezones = Intl.supportedValuesOf("timeZone");
  if (!timezones.includes("UTC")) timezones.unshift("UTC");
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !busy && !uploading) onClose();
      }}
      title={task ? "编辑自动任务" : "新建自动任务"}
      className="automation-editor"
      dismissible={!busy && !uploading}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="automation-editor-body">
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
          <section className="automation-field">
            <h3>触发器</h3>
            {draft.triggers.map((t, index) => {
              const change = (p: Partial<AutomationSchedule>) =>
                update({
                  triggers: draft.triggers.map((v) =>
                    v.id === t.id ? { ...v, ...p } : v,
                  ),
                });
              return (
                <div className="automation-schedule" key={t.id}>
                  <div className="automation-schedule-line">
                    <Clock3 size={18} />
                    <AutomationChoice
                      label={`重复频率 ${index + 1}`}
                      value={t.frequency}
                      options={Object.entries(frequencyLabels).map(
                        ([id, label]) => ({ id, label }),
                      )}
                      onChange={(v) =>
                        change({
                          frequency: v as AutomationSchedule["frequency"],
                        })
                      }
                      disabled={busy}
                    />
                    <input
                      type="time"
                      aria-label={`执行时间 ${index + 1}`}
                      required
                      value={t.time}
                      onChange={(e) => change({ time: e.target.value })}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`移除触发器 ${index + 1}`}
                      disabled={busy || draft.triggers.length === 1}
                      onClick={() =>
                        update({
                          triggers: draft.triggers.filter((v) => v.id !== t.id),
                        })
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {t.frequency === "weekly" && (
                    <div className="automation-weekdays" aria-label="执行星期">
                      {Array.from({ length: 7 }, (_, i) => (
                        <button
                          type="button"
                          key={i}
                          aria-label={`星期${"一二三四五六日"[i]}`}
                          aria-pressed={t.weekdays.includes(i + 1)}
                          disabled={busy}
                          onClick={() =>
                            change({
                              weekdays: t.weekdays.includes(i + 1)
                                ? t.weekdays.filter((v) => v !== i + 1)
                                : [...t.weekdays, i + 1].sort(),
                            })
                          }
                        >
                          {"一二三四五六日"[i]}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="automation-schedule-line">
                    <input
                      type="date"
                      aria-label={`${t.frequency === "once" ? "执行日期" : "开始日期"} ${index + 1}`}
                      required
                      value={t.date}
                      onChange={(e) => change({ date: e.target.value })}
                      disabled={busy}
                    />
                    <AutomationChoice
                      label={`时区 ${index + 1}`}
                      value={t.timezone}
                      options={timezones.map((v) => ({ id: v, label: v }))}
                      onChange={(v) => change({ timezone: v })}
                      search
                      disabled={busy}
                    />
                  </div>
                  {["monthly", "yearly"].includes(t.frequency) && (
                    <small className="muted">
                      按所选日期重复，不存在的日期跳过。
                    </small>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="automation-add-trigger"
              disabled={busy || draft.triggers.length >= 8}
              onClick={() =>
                update({ triggers: [...draft.triggers, initialSchedule()] })
              }
            >
              <Plus size={17} />
              添加触发器
            </button>
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
                <button
                  type="button"
                  className="icon-button"
                  aria-label="添加任务附件"
                  disabled={busy || uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip size={18} />
                </button>
                <button
                  type="button"
                  className="automation-capability"
                  disabled={busy}
                  onClick={(e) => mentions.open("plugins", e.currentTarget)}
                >
                  <PluginIcon size={18} />
                  连接器
                  {draft.plugins.length || draft.expertId
                    ? ` ${draft.plugins.length + (draft.expertId ? 1 : 0)}`
                    : ""}
                </button>
                <button
                  type="button"
                  className="automation-capability"
                  disabled={busy}
                  onClick={(e) => mentions.open("skills", e.currentTarget)}
                >
                  <SkillIcon size={18} />
                  技能{draft.skills.length ? ` ${draft.skills.length}` : ""}
                </button>
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
            <AutomationChoice
              label="任务模型"
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
            <FormSubmit busy={busy} disabled={uploading} busyLabel="正在保存…">
              保存
            </FormSubmit>
          </FormActions>
        </div>
      </form>
      {mailSettings && (
        <AutomationMailSettings onClose={() => setMailSettings(false)} />
      )}
    </Modal>
  );
}
