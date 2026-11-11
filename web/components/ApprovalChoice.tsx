import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Check,
  Hand,
  ShieldCheck,
  ShieldAlert,
  LoaderCircle,
} from "lucide-react";
import {
  approvalLabels,
  type ApprovalPreset,
} from "../../shared/runtime-settings";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";

const choices = {
  ask: {
    icon: Hand,
    short: "请求批准",
    description: "需要越出工作区或联网时，向你请求批准",
  },
  review: {
    icon: ShieldCheck,
    short: "帮我批准",
    description: "自动评估审批请求，仅对需要确认的操作询问你",
  },
  full: {
    icon: ShieldAlert,
    short: "完全访问",
    description: "访问服务器文件与网络，无需执行审批",
  },
};
export function ApprovalChoice({
  value,
  open,
  onOpenChange,
  disabled,
  busy,
  reading,
  error,
  presets,
  onRetry,
  onChange,
}: {
  value: ApprovalPreset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  busy: boolean;
  reading: boolean;
  error: string;
  presets: { id: string; allowed: boolean; reason?: string | null }[];
  onRetry: () => void;
  onChange: (value: ApprovalPreset) => void;
}) {
  const Icon = choices[value].icon;
  return (
    <Dropdown.Root open={open} onOpenChange={onOpenChange}>
      <Dropdown.Trigger
        type="button"
        className={`approval-trigger ${value === "full" ? "approval-full" : ""}`}
        disabled={disabled || busy}
        aria-label={`会话审批：${approvalLabels[value]}`}
        title={approvalLabels[value]}
      >
        {busy ? (
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
        ) : (
          <Icon size={18} aria-hidden="true" />
        )}
        <span>{choices[value].short}</span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <ActionMenuContent className="approval-menu" side="top">
          <div className="approval-menu-heading">
            <Dropdown.Label>执行权限</Dropdown.Label>
            <span className="approval-reading" role="status">
              {reading && (
                <>
                  <LoaderCircle size={14} className="spin" aria-hidden="true" />
                  <span className="sr-only">正在读取审批设置</span>
                </>
              )}
            </span>
          </div>
          {(Object.keys(choices) as ApprovalPreset[]).map((id) => {
            const preset = presets.find((p) => p.id === id);
            const reason =
              preset?.reason || (!reading && !preset ? "此模式暂不可用" : "");
            return (
              <ActionMenuItem
                key={id}
                role="menuitemradio"
                aria-checked={value === id}
                aria-label={approvalLabels[id]}
                icon={choices[id].icon}
                className={id === "full" ? "approval-full" : ""}
                disabled={reading || busy || !preset?.allowed}
                title={reason || undefined}
                description={reason || choices[id].description}
                trailing={
                  value === id ? (
                    <Check size={18} />
                  ) : (
                    <span className="approval-check-space" />
                  )
                }
                onSelect={() => onChange(id)}
              >
                {approvalLabels[id]}
              </ActionMenuItem>
            );
          })}
          {error && (
            <div className="menu-empty" role="alert">
              {error}
              <button type="button" onClick={onRetry}>
                重试
              </button>
            </div>
          )}
        </ActionMenuContent>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
