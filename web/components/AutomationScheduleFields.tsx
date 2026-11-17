import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, Clock3, Plus, X } from "lucide-react";
import { AutomationChoice } from "./AutomationChoice";
import { PickerContent } from "./Picker";
import {
  frequencyLabels,
  type AutomationSchedule,
} from "../../shared/automations";
export function ScheduleFields({
  value: t,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  value: AutomationSchedule;
  index: number;
  disabled: boolean;
  onChange: (p: Partial<AutomationSchedule>) => void;
  onRemove: () => void;
}) {
  const zones = ["UTC", ...Intl.supportedValuesOf("timeZone")];
  return (
    <div className="automation-schedule">
      <Clock3 size={16} />
      <div className="automation-schedule-controls">
        <AutomationChoice
          label={`重复频率 ${index}`}
          value={t.frequency}
          options={Object.entries(frequencyLabels).map(([id, label]) => ({
            id,
            label,
          }))}
          disabled={disabled}
          onChange={(v) =>
            onChange({
              frequency: v as AutomationSchedule["frequency"],
              ...(v === "hourly"
                ? { time: "09:00", until: "18:00", weekdays: [] }
                : {}),
            })
          }
        />
        <Popover.Root>
          <Popover.Trigger
            type="button"
            className="automation-choice"
            aria-label={`执行时间 ${index}`}
            disabled={disabled}
          >
            {t.time}
            {t.frequency === "hourly" ? `–${t.until || "18:00"}` : ""}
          </Popover.Trigger>
          <PickerContent className="automation-calendar" align="start">
            <label>
              {t.frequency === "hourly" ? "开始时间" : "执行时间"}
              <input
                type="time"
                aria-label={`输入执行时间 ${index}`}
                required
                value={t.time}
                disabled={disabled}
                onChange={(e) => onChange({ time: e.target.value })}
              />
            </label>
            {t.frequency === "hourly" && (
              <label>
                结束时间
                <input
                  type="time"
                  aria-label={`结束时间 ${index}`}
                  required
                  value={t.until || "18:00"}
                  disabled={disabled}
                  onChange={(e) => onChange({ until: e.target.value })}
                />
                <small className="muted">包含结束时刻，每小时执行一次。</small>
              </label>
            )}
          </PickerContent>
        </Popover.Root>
        <Popover.Root>
          <Popover.Trigger
            type="button"
            className="automation-choice automation-calendar-trigger"
            aria-label={`日期与时区 ${index}`}
            disabled={disabled}
          >
            <CalendarDays size={15} />
            <span>
              {["once", "monthly", "yearly"].includes(t.frequency)
                ? t.date
                : t.timezone.split("/").pop()?.replaceAll("_", " ")}
            </span>
          </Popover.Trigger>
          <PickerContent className="automation-calendar" align="start">
            <label>
              {t.frequency === "once" ? "执行日期" : "开始日期"}
              <input
                type="date"
                aria-label={`${t.frequency === "once" ? "执行日期" : "开始日期"} ${index}`}
                required
                value={t.date}
                disabled={disabled}
                onChange={(e) => onChange({ date: e.target.value })}
              />
            </label>
            <label>
              时区
              <AutomationChoice
                label={`时区 ${index}`}
                value={t.timezone}
                options={zones.map((id) => ({ id, label: id }))}
                onChange={(timezone) => onChange({ timezone })}
                search
                disabled={disabled}
              />
            </label>
            {["monthly", "yearly"].includes(t.frequency) && (
              <small className="muted">不存在的日期跳过。</small>
            )}
          </PickerContent>
        </Popover.Root>
        {["weekly", "hourly"].includes(t.frequency) && (
          <Popover.Root>
            <Popover.Trigger
              type="button"
              className="automation-choice"
              aria-label={`执行星期 ${index}`}
              disabled={disabled}
            >
              {!t.weekdays.length
                ? t.frequency === "hourly"
                  ? "每天"
                  : "选择星期"
                : `周${t.weekdays.map((d) => "一二三四五六日"[d - 1]).join("、")}`}
            </Popover.Trigger>
            <PickerContent className="automation-days" align="start">
              <div
                className="automation-weekdays"
                role="group"
                aria-label={`执行星期 ${index}`}
              >
                {Array.from({ length: 7 }, (_, i) => (
                  <button
                    type="button"
                    key={i}
                    aria-label={`星期${"一二三四五六日"[i]}`}
                    aria-pressed={t.weekdays.includes(i + 1)}
                    disabled={disabled}
                    onClick={() =>
                      onChange({
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
              {t.frequency === "hourly" && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => onChange({ weekdays: [] })}
                >
                  每天
                </button>
              )}
            </PickerContent>
          </Popover.Root>
        )}
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={`移除触发器 ${index}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X size={16} />
      </button>
    </div>
  );
}
export function AddSchedule({
  disabled,
  onAdd,
  sources = [],
  onSubscription,
  onIncoming,
}: {
  disabled: boolean;
  onAdd: (frequency: AutomationSchedule["frequency"]) => void;
  sources?: { id: string; label: string }[];
  onSubscription?: (providerId: string) => void;
  onIncoming?: () => void;
}) {
  return (
    <AutomationChoice
      label="添加触发器"
      value=""
      trigger={
        <>
          <Plus size={15} />
          添加触发器
        </>
      }
      search
      options={[
        ...Object.entries(frequencyLabels).map(([id, label]) => ({
          id,
          label,
          group: "时间",
        })),
        ...(onIncoming
          ? [{ id: "incoming", label: "接收事件", group: "外部事件" }]
          : []),
        ...sources.map((s) => ({
          id: "source:" + s.id,
          label: s.label,
          group: "来自插件",
        })),
      ]}
      disabled={disabled}
      onChange={(v) =>
        v === "incoming"
          ? onIncoming?.()
          : v.startsWith("source:")
            ? onSubscription?.(v.slice(7))
            : onAdd(v as AutomationSchedule["frequency"])
      }
    />
  );
}
