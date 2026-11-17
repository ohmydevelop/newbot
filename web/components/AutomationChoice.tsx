import { Fragment, useId, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { PickerContent } from "./Picker";
import { SearchIcon } from "./ReferenceIcons";
export function AutomationChoice({
  label,
  value,
  options,
  onChange,
  search = false,
  disabled = false,
  trigger,
  displayValue,
}: {
  label: string;
  value: string;
  options: { id: string; label: string; group?: string }[];
  onChange: (v: string) => void;
  search?: boolean;
  disabled?: boolean;
  trigger?: ReactNode;
  displayValue?: string;
}) {
  const id = useId();
  const groups = [...new Set(options.map((v) => v.group))];
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const visible = options.filter((v) =>
    v.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setQuery("");
      }}
    >
      <Popover.Trigger
        type="button"
        className="automation-choice"
        aria-label={label}
        title={options.find((v) => v.id === value)?.label || value || label}
        disabled={disabled}
      >
        {trigger || (
          <>
            <span>
              {displayValue ||
                options.find((v) => v.id === value)?.label ||
                value ||
                label}
            </span>
            <ChevronDown size={15} />
          </>
        )}
      </Popover.Trigger>
      <PickerContent className="automation-options" align="start">
        {search && (
          <div className="picker-search">
            <SearchIcon size={17} />
            <input
              aria-label={`搜索${label}`}
              placeholder="搜索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        <div className="picker-results">
          {visible.map((v, index) => (
            <Fragment key={v.id}>
              {v.group && visible[index - 1]?.group !== v.group && (
                <h3
                  className="automation-option-group"
                  id={`${id}-group-${groups.indexOf(v.group)}`}
                >
                  {v.group}
                </h3>
              )}
              <button
                type="button"
                aria-describedby={
                  v.group ? `${id}-group-${groups.indexOf(v.group)}` : undefined
                }
                aria-pressed={v.id === value}
                onClick={() => {
                  onChange(v.id);
                  setOpen(false);
                }}
              >
                <span>{v.label}</span>
                {v.id === value && <Check size={16} />}
              </button>
            </Fragment>
          ))}
          {!visible.length && <p className="picker-note">没有匹配的选项</p>}
        </div>
      </PickerContent>
    </Popover.Root>
  );
}
