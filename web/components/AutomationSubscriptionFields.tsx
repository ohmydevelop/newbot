import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Link, Plus, RefreshCw, X } from "lucide-react";
import { PluginIcon } from "./AppIcons";
import { PickerContent } from "./Picker";
import { EventConfigurationFields } from "./EventConfigurationFields";
import { AutomationChoice } from "./AutomationChoice";
import { automationRequest } from "../automations";
import type {
  Automation,
  AutomationEventTrigger,
} from "../../shared/automations";
import {
  subscriptionStateLabels,
  type EventCatalog,
} from "../../shared/event-subscriptions";

export function useEventCatalog() {
  const [catalog, setCatalog] = useState<EventCatalog>({
    providers: [],
    accounts: [],
  });
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void automationRequest<EventCatalog>("/sources", undefined, abort.signal)
      .then((v) => {
        if (!abort.signal.aborted) {
          setCatalog(v);
          setError("");
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [version]);
  return { catalog, error, refresh: () => setVersion((v) => v + 1) };
}
export function SubscriptionFields({
  value: t,
  index,
  disabled,
  onChange,
  onRemove,
  catalog,
  refresh,
}: {
  value: AutomationEventTrigger;
  index: number;
  disabled: boolean;
  onChange: (v: Partial<AutomationEventTrigger>) => void;
  onRemove: () => void;
  catalog: EventCatalog;
  refresh: () => void;
}) {
  const provider = catalog.providers.find((p) => p.id === t.providerId);
  const account = catalog.accounts.find((a) => a.id === t.connectionId);
  const [editing, setEditing] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null),
    [name, setName] = useState(""),
    [values, setValues] = useState<Record<string, string | number | boolean>>(
      {},
    ),
    [secrets, setSecrets] = useState<Record<string, string>>({}),
    [authorizationUrl, setAuthorizationUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null),
    draftId = useRef(crypto.randomUUID()),
    pending = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  async function save(reuseConnection = false) {
    if (pending.current || !provider) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    request.current = abort;
    try {
      const result = await automationRequest<{ id: string }>(
        "/accounts/save",
        {
          id: editingId || draftId.current,
          revision: editingId ? account?.revision || 0 : 0,
          providerId: provider.id,
          label: name.trim() || provider.label,
          ...(reuseConnection
            ? { reuseConnection: true }
            : { values, secrets }),
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;

      setSecrets({});
      setEditing(false);
      onChange({ connectionId: result.id });
      refresh();
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "连接失败");
    } finally {
      pending.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  async function remove() {
    if (pending.current || !account) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    request.current = abort;
    try {
      await automationRequest(
        "/accounts/delete",
        { id: account.id, revision: account.revision },
        abort.signal,
      );
      if (!abort.signal.aborted) {
        setSecrets({});
        setEditing(false);
        onChange({ connectionId: "" });
        refresh();
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      pending.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="automation-schedule">
      <PluginIcon size={16} />
      <div className="automation-schedule-controls">
        <Popover.Root
          onOpenChange={(open) => {
            if (!open) {
              request.current?.abort();
              pending.current = false;
              setBusy(false);

              setSecrets({});
              setEditing(false);
              setAuthorizationUrl("");
            }
          }}
        >
          <Popover.Trigger
            type="button"
            className="automation-choice"
            disabled={disabled}
            aria-label={`应用事件条件 ${index}`}
          >
            <span className="automation-event-source">
              {provider?.label || "应用不可用"}
            </span>
            <span className="muted">
              {Object.values(t.arguments)
                .filter((v) => typeof v === "string")
                .join(" · ") || "设置条件"}
            </span>
          </Popover.Trigger>
          <PickerContent className="automation-event-settings" align="start">
            <strong>{provider?.label || "应用不可用"}</strong>
            <AutomationChoice
              label="事件账号"
              value={t.connectionId || ""}
              displayValue={account?.label}
              options={catalog.accounts
                .filter((a) => a.providerId === t.providerId && a.available)
                .map((a) => ({ id: a.id, label: a.label }))}
              onChange={(connectionId) => onChange({ connectionId })}
              disabled={busy || editing || !provider}
            />
            {!editing && (
              <button
                type="button"
                className="text-button"
                disabled={!provider}
                onClick={() => {
                  setEditing(true);
                  setEditingId(null);
                  draftId.current = crypto.randomUUID();
                  setName("");
                  setValues({});
                  setSecrets({});

                  setSecrets({});
                  setError("");
                }}
              >
                <Plus size={15} />
                连接账号
              </button>
            )}
            {!editing && provider?.reusableConnection && !account && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void save(true)}
              >
                使用已配置的连接
              </button>
            )}
            {!editing && account && provider?.oauth && (
              <>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    if (pending.current) return;
                    pending.current = true;
                    setBusy(true);
                    setError("");
                    const abort = new AbortController();
                    request.current = abort;
                    try {
                      const result = await automationRequest<{
                        url: string;
                        authorized: boolean;
                      }>(
                        "/accounts/oauth/start",
                        { id: account.id },
                        abort.signal,
                      );
                      if (!abort.signal.aborted) {
                        if (result.url) setAuthorizationUrl(result.url);
                        else refresh();
                      }
                    } catch (e) {
                      if (!abort.signal.aborted)
                        setError(
                          e instanceof Error ? e.message : "无法开始授权",
                        );
                    } finally {
                      if (!abort.signal.aborted) {
                        pending.current = false;
                        setBusy(false);
                      }
                    }
                  }}
                >
                  授权账号
                </button>
                {authorizationUrl && (
                  <>
                    <a
                      className="text-button"
                      href={authorizationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      前往授权
                    </a>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setAuthorizationUrl("");
                        refresh();
                      }}
                    >
                      刷新连接
                    </button>
                  </>
                )}
              </>
            )}
            {!editing && account && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEditing(true);
                  setEditingId(account.id);
                  setName(account.label);
                  setValues(account.values || {});
                  setSecrets({});

                  setSecrets({});
                  setError("");
                }}
              >
                编辑账号
              </button>
            )}
            {editing && (
              <>
                <label>
                  账号名称
                  <input
                    aria-label="事件账号名称"
                    placeholder="工作账号"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                {(provider?.fields || []).map((field) => (
                  <label
                    key={field.id}
                    className={
                      field.type === "boolean"
                        ? "automation-event-checkbox"
                        : undefined
                    }
                  >
                    {field.title}
                    <input
                      aria-label={field.title}
                      type={
                        field.sensitive
                          ? "password"
                          : field.type === "boolean"
                            ? "checkbox"
                            : field.type === "number"
                              ? "number"
                              : "text"
                      }
                      autoComplete={
                        field.sensitive ? "new-password" : undefined
                      }
                      placeholder={
                        editingId && account?.secretFields?.includes(field.id)
                          ? "已保存，输入新值可替换"
                          : undefined
                      }
                      value={
                        field.sensitive
                          ? secrets[field.id] || ""
                          : field.type === "boolean"
                            ? undefined
                            : String(values[field.id] ?? "")
                      }
                      checked={
                        field.type === "boolean"
                          ? values[field.id] === true
                          : undefined
                      }
                      maxLength={4096}
                      disabled={busy}
                      onChange={(e) =>
                        field.sensitive
                          ? setSecrets({
                              ...secrets,
                              [field.id]: e.target.value,
                            })
                          : setValues({
                              ...values,
                              [field.id]:
                                field.type === "boolean"
                                  ? e.target.checked
                                  : field.type === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                            })
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "正在保存…" : "保存账号"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    删除账号并暂停关联任务
                  </button>
                )}
              </>
            )}
            <AutomationChoice
              label="订阅事件"
              value={t.events[0] || ""}
              options={provider?.events || []}
              onChange={(v) => onChange({ events: [v], arguments: {} })}
              disabled={!provider || busy}
              search
            />
            <EventConfigurationFields
              schema={
                (
                  provider?.events.find((e) => e.id === t.events[0]) ||
                  provider?.events[0]
                )?.inputSchema || { type: "object" }
              }
              value={t.arguments}
              onChange={(v) =>
                onChange({
                  arguments: v as AutomationEventTrigger["arguments"],
                })
              }
              disabled={busy}
            />
            {provider?.state && (
              <p className="muted">
                {subscriptionStateLabels[provider.state] || "应用暂不可用"}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </PickerContent>
        </Popover.Root>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={`移除事件触发器 ${index}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X size={16} />
      </button>
    </div>
  );
}
export function SubscriptionConnection({
  task,
  trigger,
}: {
  task: Automation;
  trigger: AutomationEventTrigger;
}) {
  const [open, setOpen] = useState(false),
    [state, setState] = useState("pending"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await automationRequest<{ state: string }>(
          "/subscription-status",
          { taskId: task.id, triggerId: trigger.id },
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setState(value.state);
          setError("");
        }
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "读取失败");
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 5000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [open, version, task.id, trigger.id]);
  async function retry() {
    if (busy) return;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    request.current = abort;
    try {
      await automationRequest(
        "/subscription-retry",
        { taskId: task.id, triggerId: trigger.id },
        abort.signal,
      );
      if (!abort.signal.aborted) setVersion((v) => v + 1);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "重试失败");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          request.current?.abort();
          setBusy(false);
        }
      }}
    >
      <Popover.Trigger
        type="button"
        className="automation-choice"
        aria-label="订阅状态"
      >
        <Link size={15} />
        订阅状态
      </Popover.Trigger>
      <PickerContent className="automation-event-settings" align="start">
        <strong>{"应用事件"}</strong>
        <p role="status">{subscriptionStateLabels[state] || "需要检查连接"}</p>
        {!["ready", "baseline", "pending", "disabled"].includes(state) && (
          <button
            type="button"
            className="text-button"
            onClick={() => void retry()}
            disabled={busy}
          >
            <RefreshCw size={15} />
            重试连接
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </PickerContent>
    </Popover.Root>
  );
}
