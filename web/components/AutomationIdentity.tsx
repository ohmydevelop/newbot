import * as Popover from "@radix-ui/react-popover";
import { PickerContent } from "./Picker";
import {
  Clock3,
  Sun,
  Newspaper,
  ChartNoAxesCombined,
  CalendarDays,
  BookOpen,
  ShieldCheck,
  HeartPulse,
  Languages,
} from "lucide-react";
import type { AutomationInput } from "../../shared/automations";
export const automationIcons = {
  clock: { icon: Clock3, label: "时钟" },
  sun: { icon: Sun, label: "晨间" },
  news: { icon: Newspaper, label: "资讯" },
  chart: { icon: ChartNoAxesCombined, label: "行情" },
  calendar: { icon: CalendarDays, label: "日程" },
  research: { icon: BookOpen, label: "研究" },
  shield: { icon: ShieldCheck, label: "安全" },
  health: { icon: HeartPulse, label: "生活" },
  language: { icon: Languages, label: "语言" },
};
export function AutomationIdentity({
  icon = "clock",
  color,
}: {
  icon?: AutomationInput["icon"];
  color?: AutomationInput["color"];
}) {
  const Icon = (automationIcons[icon] || automationIcons.clock).icon;
  return (
    <span className="automation-identity" data-icon={icon} data-color={color}>
      <Icon size={18} />
    </span>
  );
}

const colors = {
  default: "默认",
  blue: "蓝色",
  orange: "橙色",
  green: "绿色",
  red: "红色",
};
export function AutomationIconPicker({
  icon,
  color,
  disabled,
  onChange,
}: {
  icon: AutomationInput["icon"];
  color: AutomationInput["color"];
  disabled: boolean;
  onChange: (v: Partial<AutomationInput>) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className="automation-icon-trigger"
        type="button"
        aria-label="任务图标"
        disabled={disabled}
      >
        <AutomationIdentity icon={icon} color={color} />
      </Popover.Trigger>
      <PickerContent className="automation-icon-picker" align="start">
        <div
          className="automation-color-options"
          role="group"
          aria-label="图标颜色"
        >
          {Object.entries(colors).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={(color || "default") === id}
              onClick={() =>
                onChange({ color: id as AutomationInput["color"] })
              }
            >
              <AutomationIdentity
                icon={icon}
                color={id as AutomationInput["color"]}
              />
            </button>
          ))}
        </div>
        <div className="automation-icon-options" role="group" aria-label="图标">
          {Object.entries(automationIcons).map(([id, v]) => (
            <button
              key={id}
              type="button"
              aria-label={v.label}
              aria-pressed={(icon || "clock") === id}
              onClick={() => onChange({ icon: id as AutomationInput["icon"] })}
            >
              <v.icon size={18} />
            </button>
          ))}
        </div>
      </PickerContent>
    </Popover.Root>
  );
}
