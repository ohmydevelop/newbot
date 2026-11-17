import type { EventSchema } from "../../shared/event-schema";
import { AutomationChoice } from "./AutomationChoice";

export function EventConfigurationFields({
  schema,
  value,
  onChange,
  disabled = false,
  prefix = "",
}: {
  schema: EventSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
  prefix?: string;
}) {
  return (
    <>
      {Object.entries(schema.properties || {}).map(([key, field]) => {
        const label = field.title || key,
          id = prefix + key,
          current = value[key] ?? field.default;
        const change = (next: unknown) => onChange({ ...value, [key]: next });
        if (field.type === "object")
          return (
            <fieldset key={key}>
              <legend>{label}</legend>
              <EventConfigurationFields
                schema={field}
                value={(current || {}) as Record<string, unknown>}
                onChange={change}
                disabled={disabled}
                prefix={id + "."}
              />
            </fieldset>
          );
        if (field.enum)
          return (
            <div key={key} className="automation-event-field">
              <span>{label}</span>
              <AutomationChoice
                label={label}
                value={current === undefined ? "" : String(current)}
                options={field.enum.map((v) => ({
                  id: String(v),
                  label: String(v),
                }))}
                onChange={(v) =>
                  change(field.enum!.find((x) => String(x) === v))
                }
                disabled={disabled}
                search
              />
            </div>
          );
        if (field.type === "array" && field.items?.enum)
          return (
            <fieldset key={key}>
              <legend>{label}</legend>
              {field.items.enum.map((option) => (
                <label
                  key={String(option)}
                  className="automation-event-checkbox"
                >
                  <input
                    type="checkbox"
                    checked={Array.isArray(current) && current.includes(option)}
                    disabled={disabled}
                    onChange={(e) =>
                      change(
                        e.target.checked
                          ? [...(Array.isArray(current) ? current : []), option]
                          : (Array.isArray(current) ? current : []).filter(
                              (v) => v !== option,
                            ),
                      )
                    }
                  />
                  {String(option)}
                </label>
              ))}
            </fieldset>
          );
        if (field.type === "array")
          return (
            <label key={key}>
              {label}
              <textarea
                aria-label={label}
                disabled={disabled}
                value={Array.isArray(current) ? current.join("\n") : ""}
                onChange={(e) =>
                  change(e.target.value.split("\n").filter(Boolean))
                }
              />
            </label>
          );
        if (field.type === "boolean")
          return (
            <label key={key} className="automation-event-checkbox">
              <input
                type="checkbox"
                aria-label={label}
                checked={current === true}
                disabled={disabled}
                onChange={(e) => change(e.target.checked)}
              />
              {label}
            </label>
          );
        return (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              type={
                field.type === "number" || field.type === "integer"
                  ? "number"
                  : "text"
              }
              value={current === undefined ? "" : String(current)}
              maxLength={field.maxLength ?? 4096}
              min={field.minimum}
              max={field.maximum}
              required={schema.required?.includes(key)}
              disabled={disabled}
              onChange={(e) =>
                change(
                  field.type === "string"
                    ? e.target.value
                    : e.target.value === ""
                      ? undefined
                      : Number(e.target.value),
                )
              }
            />
          </label>
        );
      })}
    </>
  );
}
