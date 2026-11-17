import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Copy, KeyRound, Link, RefreshCw, Webhook, X } from "lucide-react";
import { PickerContent } from "./Picker";
import { automationRequest } from "../automations";
import { SubscriptionConnection } from "./AutomationSubscriptionFields";
import {
  eventSourceLabels,
  type Automation,
  type AutomationEventTrigger,
} from "../../shared/automations";
function WebhookConnection({
  task,
  trigger,
}: {
  task: Automation;
  trigger: AutomationEventTrigger;
}) {
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<{
    path: string;
    source: string;
    secret: string;
    version: string;
  } | null>(null);
  async function load(rotate = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await automationRequest(
        "/event-settings",
        {
          taskId: task.id,
          triggerId: trigger.id,
          revision: task.revision,
          rotate,
          expectedVersion: rotate ? settings?.version : undefined,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setSettings(result);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("已复制");
    } catch {
      setError("复制失败，请选中内容后复制");
    }
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        request.current?.abort();
        setOpen(v);
        setSettings(null);
        setNotice("");
        if (v) void load();
      }}
    >
      <Popover.Trigger
        type="button"
        className="automation-choice"
        aria-label={`${eventSourceLabels[trigger.source]} 连接设置`}
      >
        <Link size={15} />
        连接设置
      </Popover.Trigger>
      <PickerContent className="automation-event-settings" align="start">
        <strong>{eventSourceLabels[trigger.source]}</strong>
        {busy && !settings && <p role="status">正在读取…</p>}
        {settings && (
          <>
            <label>
              接收地址
              <div className="automation-event-copy">
                <input
                  aria-label="事件接收地址"
                  readOnly
                  value={new URL(settings.path, location.origin).href}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="复制接收地址"
                  onClick={() =>
                    void copy(new URL(settings.path, location.origin).href)
                  }
                >
                  <Copy size={16} />
                </button>
              </div>
            </label>
            <label>
              {trigger.source === "openclaw" ? "访问令牌" : "签名密钥"}
              <div className="automation-event-copy">
                <input
                  aria-label="事件密钥"
                  type="password"
                  readOnly
                  value={settings.secret}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="复制事件密钥"
                  onClick={() => void copy(settings.secret)}
                >
                  <KeyRound size={16} />
                </button>
              </div>
            </label>
            <small className="muted">
              {trigger.source === "github"
                ? "GitHub Webhook · application/json · SHA-256 签名"
                : trigger.source === "openclaw"
                  ? "Bearer 令牌 · Idempotency-Key · message 正文"
                  : trigger.source === "hermes"
                    ? "Hermes V2 · 时间戳签名，有效期 5 分钟"
                    : "Standard Webhooks · 事件标识与时间戳签名"}
            </small>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void load(true)}
            >
              <RefreshCw size={15} />
              更换密钥
            </button>
          </>
        )}
        {notice && <small role="status">{notice}</small>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </PickerContent>
    </Popover.Root>
  );
}
export function EventConnection(props: {
  task: Automation;
  trigger: AutomationEventTrigger;
}) {
  return props.trigger.source === "subscription" ? (
    <SubscriptionConnection {...props} />
  ) : (
    <WebhookConnection {...props} />
  );
}
function FilterInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  return (
    <label>
      {label.split("，")[0]}
      <input
        aria-label={label}
        placeholder={label}
        value={text}
        maxLength={1000}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(/[,，]/)
              .map((v) => v.trim())
              .filter(Boolean),
          );
        }}
      />
    </label>
  );
}
export function EventTriggerFields({
  value: t,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  value: AutomationEventTrigger;
  index: number;
  disabled: boolean;
  onChange: (p: Partial<AutomationEventTrigger>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="automation-schedule">
      <Webhook size={16} />
      <div className="automation-schedule-controls">
        <Popover.Root>
          <Popover.Trigger
            type="button"
            className="automation-choice"
            disabled={disabled}
            aria-label={`事件条件 ${index}`}
          >
            <span className="automation-event-source">
              {eventSourceLabels[t.source]}
            </span>
            <span className="muted">
              {t.repository || t.events.join(", ") || "所有事件"}
            </span>
          </Popover.Trigger>
          <PickerContent className="automation-event-settings" align="start">
            <strong>{eventSourceLabels[t.source]}</strong>
            <FilterInput
              label="事件类型，逗号分隔"
              value={t.events}
              onChange={(events) => onChange({ events })}
            />
            {t.source === "github" && (
              <>
                <label>
                  仓库
                  <input
                    aria-label="仓库 owner/repo"
                    placeholder="仓库 owner/repo"
                    value={t.repository}
                    maxLength={200}
                    onChange={(e) => onChange({ repository: e.target.value })}
                  />
                </label>
                <FilterInput
                  label="事件动作，逗号分隔"
                  value={t.actions}
                  onChange={(actions) => onChange({ actions })}
                />
              </>
            )}
            <small className="muted">
              保存后可获取接收地址与密钥。留空接收所有事件。
            </small>
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
