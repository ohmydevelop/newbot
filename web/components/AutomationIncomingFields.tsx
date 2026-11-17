import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDownToLine, Copy, RefreshCw, X } from "lucide-react";
import { PickerContent } from "./Picker";
import { automationRequest } from "../automations";
import type {
  Automation,
  AutomationEventTrigger,
} from "../../shared/automations";

type IncomingTrigger = Extract<AutomationEventTrigger, { source: "incoming" }>;
export function IncomingFields({
  value,
  disabled,
  onChange,
  onRemove,
}: {
  value: IncomingTrigger;
  disabled: boolean;
  onChange: (events: string[]) => void;
  onRemove: () => void;
}) {
  return (
    <div className="automation-schedule">
      <ArrowDownToLine size={16} />
      <div className="automation-schedule-controls">
        <Popover.Root>
          <Popover.Trigger
            type="button"
            className="automation-choice"
            disabled={disabled}
            aria-label="接收事件条件"
          >
            接收事件{" "}
            <span className="muted">
              {value.events.join(", ") || "全部类型"}
            </span>
          </Popover.Trigger>
          <PickerContent className="automation-event-settings" align="start">
            <label>
              事件类型
              <input
                aria-label="接收事件类型"
                placeholder="全部类型"
                value={value.events[0] || ""}
                maxLength={160}
                disabled={disabled}
                onChange={(e) =>
                  onChange(e.target.value ? [e.target.value] : [])
                }
              />
            </label>
            <small className="muted">保存后获取接收地址与凭证。</small>
          </PickerContent>
        </Popover.Root>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="移除接收事件"
        disabled={disabled}
        onClick={onRemove}
      >
        <X size={16} />
      </button>
    </div>
  );
}
export function IncomingConnection({
  task,
  trigger,
}: {
  task: Automation;
  trigger: IncomingTrigger;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState("");
  const [connection, setConnection] = useState<{
    url: string;
    token: string;
    enabled: boolean;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load(rotate = false) {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError("");
    setCopied("");
    try {
      const result = await automationRequest<{
        url: string;
        token: string;
        enabled: boolean;
      }>(
        "/incoming-connection",
        {
          taskId: task.id,
          triggerId: trigger.id,
          revision: task.revision,
          rotate,
        },
        abort.signal,
      );
      if (!abort.signal.aborted) setConnection(result);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "无法获取接收配置");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    const current = request.current;
    try {
      await navigator.clipboard.writeText(value);
      if (current && !current.signal.aborted) {
        setError("");
        setCopied(label + "已复制");
      }
    } catch {
      if (current && !current.signal.aborted)
        setError("复制失败，请选择输入框内容复制");
    }
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setConnection(null);
        setCopied("");
        setError("");
        if (next) void load();
        else {
          request.current?.abort();
          setBusy(false);
        }
      }}
    >
      <Popover.Trigger
        type="button"
        className="automation-choice"
        aria-label="接收配置"
      >
        <ArrowDownToLine size={15} />
        接收配置
      </Popover.Trigger>
      <PickerContent className="automation-event-settings" align="start">
        <strong>接收事件</strong>
        {connection && (
          <>
            <label>
              接收地址
              <input
                aria-label="接收地址"
                readOnly
                value={connection.url}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void copy(connection.url, "地址")}
            >
              <Copy size={15} />
              复制地址
            </button>
            <label>
              访问凭证
              <input
                aria-label="访问凭证"
                type="password"
                autoComplete="off"
                readOnly
                value={connection.token}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void copy(connection.token, "凭证")}
            >
              <Copy size={15} />
              复制凭证
            </button>
            <small className="muted">
              POST CloudEvents JSON，使用 Bearer 凭证。
            </small>
            {!connection.enabled && (
              <p role="status">任务已暂停，不接收事件。</p>
            )}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void load(true)}
            >
              <RefreshCw size={15} />
              更换凭证
            </button>
          </>
        )}
        {busy && <p role="status">正在获取…</p>}
        {copied && <p role="status">{copied}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {error && !connection && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void load()}
          >
            重试
          </button>
        )}
      </PickerContent>
    </Popover.Root>
  );
}
