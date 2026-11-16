import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Check,
  Hand,
  ShieldCheck,
  ShieldAlert,
  LoaderCircle,
  MessageCircle,
  ListChecks,
  Play,
  LockKeyhole,
} from "lucide-react";
import {
  approvalLabels,
  modeLabels,
  modeDescriptions,
  type InteractionMode,
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
  mode = "work",
  currentMode = mode,
  pending,
  pendingError,
  onMode,
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
  mode?: InteractionMode;
  currentMode?: InteractionMode;
  pending?: boolean;
  pendingError?: string;
  onMode?: (mode: InteractionMode) => void;
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
  const Icon = currentMode === "work" ? choices[value].icon : LockKeyhole;
  const icons = {chat: MessageCircle, plan: ListChecks, work: Play};
  return (
    <Dropdown.Root open={open} onOpenChange={onOpenChange}>
      <Dropdown.Trigger
        type="button"
        className={`approval-trigger ${currentMode === "work" && value === "full" ? "approval-full" : ""}`}
        disabled={disabled || busy}
        aria-label={`交互模式：${modeLabels[currentMode]}`}
        title={`${modeLabels[currentMode]} · ${currentMode === "work" ? approvalLabels[value] : "只读"}${pending ? `；下一轮：${modeLabels[mode]}` : ""}`}
      >
        {busy ? (
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
        ) : (
          <Icon size={18} aria-hidden="true" />
        )}
        <span>{modeLabels[currentMode]}{pending && mode !== currentMode ? ` → ${modeLabels[mode]}` : ""}</span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <ActionMenuContent className="approval-menu" side="top">
          {onMode && (Object.keys(modeLabels) as InteractionMode[]).map(id => (
            <ActionMenuItem key={id} role="menuitemradio" aria-checked={mode === id}
              aria-label={modeLabels[id]} icon={icons[id]} description={modeDescriptions[id]}
              disabled={busy} trailing={mode === id ? <Check size={18} /> : undefined}
              onSelect={() => onMode(id)}>{modeLabels[id]}</ActionMenuItem>
          ))}
          {pending && <p className="picker-note" role="status">{pendingError || `当前${modeLabels[currentMode]}，下一轮使用${modeLabels[mode]}`}</p>}
          {mode !== "work" && <p className="picker-note">只读 · 工作权限保持原设置</p>}
          {mode === "work" && <>
          <Dropdown.Separator className="action-menu-separator" />
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
          </>}
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
