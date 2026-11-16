import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { ActionMenuContent } from "./ActionMenu";

export function CatalogFilter({
  label,
  id,
  disabled = false,
  placeholder,
  value,
  options,
  onValueChange,
}: {
  label: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        id={id}
        disabled={disabled}
        className="market-filter-trigger"
        aria-label={label}
      >
        <span>
          {options.find((option) => option.value === value)?.label ||
            placeholder ||
            options[0]?.label}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <ActionMenuContent className="market-filter-menu" align="start">
          <Dropdown.RadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <Dropdown.RadioItem
                className="market-filter-option"
                value={option.value}
                key={option.value}
              >
                <span title={option.label}>{option.label}</span>
                <Dropdown.ItemIndicator>
                  <Check size={16} aria-hidden="true" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
        </ActionMenuContent>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
