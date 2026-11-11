import ChartView from "../Chart";
import { MediaImage } from "../MediaImage";
import { createContext, useContext, useId } from "react";
import { Catalog } from "@a2ui/web_core/v0_9";
import {
  createComponentImplementation,
  type ReactCatalogComponent,
} from "@a2ui/react/v0_9";
import { a2uiApis, richA2uiApis } from "../../../shared/a2ui-catalog.js";
import {
  A2UI_RICH_CATALOG_ID,
  A2UI_CATALOG_ID,
  A2UI_LIMITS,
} from "../../../shared/a2ui-policy.js";

export const A2uiControls = createContext({
  disabled: false,
  descriptionId: "",
});
const text = (value: unknown) =>
  typeof value === "string" ? value.slice(0, A2UI_LIMITS.string) : "";

const Text = createComponentImplementation(a2uiApis.Text, ({ props }) => {
  const content = text(props.text);
  if (props.variant === "h3")
    return <h3 className="a2ui-heading">{content}</h3>;
  return (
    <p className={props.variant === "caption" ? "a2ui-caption" : "a2ui-text"}>
      {content}
    </p>
  );
});
const Column = createComponentImplementation(
  a2uiApis.Column,
  ({ props, buildChild }) => (
    <div className="a2ui-column">
      {props.children.map((child) =>
        typeof child === "string"
          ? buildChild(child)
          : buildChild(child.id, child.basePath),
      )}
    </div>
  ),
);
const Row = createComponentImplementation(
  a2uiApis.Row,
  ({ props, buildChild }) => (
    <div className="a2ui-row">
      {props.children.map((child) =>
        typeof child === "string"
          ? buildChild(child)
          : buildChild(child.id, child.basePath),
      )}
    </div>
  ),
);
const TextField = createComponentImplementation(
  a2uiApis.TextField,
  ({ props, context }) => {
    const controls = useContext(A2uiControls),
      id = useId();
    const raw = context.componentModel.properties.value;
    const bound = !!raw && typeof raw === "object" && "path" in raw;
    const value = text(props.value);
    const input = {
      id,
      value,
      disabled: controls.disabled,
      readOnly: !bound,
      maxLength: A2UI_LIMITS.string,
      "aria-describedby": controls.descriptionId,
      autoComplete: "off",
      spellCheck: false,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => props.setValue(event.target.value.slice(0, A2UI_LIMITS.string)),
    };
    return (
      <div className="a2ui-field">
        <label htmlFor={id}>{props.label}</label>
        {props.variant === "longText" ? (
          <textarea {...input} rows={3} />
        ) : (
          <input {...input} type="text" />
        )}
      </div>
    );
  },
);
const ChoicePicker = createComponentImplementation(
  a2uiApis.ChoicePicker,
  ({ props, context }) => {
    const controls = useContext(A2uiControls),
      id = useId();
    const raw = context.componentModel.properties.value;
    const bound = !!raw && typeof raw === "object" && "path" in raw;
    const selected = Array.isArray(props.value)
      ? props.value.filter((v): v is string => typeof v === "string")
      : [];
    if (props.variant !== "multipleSelection")
      return (
        <div className="a2ui-field">
          <label htmlFor={id}>{props.label}</label>
          <select
            id={id}
            value={selected[0] ?? ""}
            disabled={controls.disabled || !bound}
            aria-describedby={controls.descriptionId}
            onChange={(event) =>
              props.setValue(event.target.value ? [event.target.value] : [])
            }
          >
            <option value="">请选择</option>
            {props.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    return (
      <fieldset
        className="a2ui-choice"
        disabled={controls.disabled || !bound}
        aria-describedby={controls.descriptionId}
      >
        <legend>{props.label}</legend>
        {props.options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) =>
                props.setValue(
                  event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value),
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    );
  },
);
const Button = createComponentImplementation(
  a2uiApis.Button,
  ({ props, buildChild }) => {
    const controls = useContext(A2uiControls);
    return (
      <button
        type="button"
        className={`a2ui-button a2ui-button-${props.variant ?? "default"}`}
        disabled={controls.disabled}
        onClick={() => props.action()}
      >
        {buildChild(props.child)}
      </button>
    );
  },
);

const Image = createComponentImplementation(richA2uiApis.Image, ({ props }) => (
  <MediaImage
    media={{
      id: props.source,
      state: "ready",
      url: props.source,
      label: props.alt,
    }}
  />
));
const Metric = createComponentImplementation(
  richA2uiApis.Metric,
  ({ props }) => (
    <div className="a2ui-metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail && <small>{props.detail}</small>}
    </div>
  ),
);
const SourceLink = createComponentImplementation(
  richA2uiApis.SourceLink,
  ({ props }) => (
    <a href={props.url} target="_blank" rel="noopener noreferrer">
      {props.label}
    </a>
  ),
);
const Chart = createComponentImplementation(richA2uiApis.Chart, ({ props }) => (
  <ChartView
    code={JSON.stringify({
      title: { text: props.title, textStyle: { fontSize: 14 } },
      tooltip: {},
      legend: { bottom: 0 },
      grid: { left: 48, right: 20, top: 48, bottom: 64 },
      ...(props.kind !== "pie"
        ? {
            xAxis: { type: "category", data: props.labels },
            yAxis: { type: "value" },
          }
        : {}),
      series: props.series.map((s) => ({
        name: s.name,
        type: props.kind,
        data:
          props.kind === "pie"
            ? s.values.map((value, i) => ({ name: props.labels[i], value }))
            : s.values,
      })),
    })}
  />
));
// 0.14's React factory drops parent/child policy fields; copy them explicitly.
const implementations = [
  Text,
  Column,
  Row,
  TextField,
  ChoicePicker,
  Button,
].map((implementation) => ({
  ...a2uiApis[implementation.name as keyof typeof a2uiApis],
  ...implementation,
}));
export function createA2uiCatalog(id: string = A2UI_CATALOG_ID) {
  return new Catalog<ReactCatalogComponent>(
    id,
    "0.9",
    id === A2UI_RICH_CATALOG_ID
      ? [
          ...implementations,
          ...[Image, Metric, Chart, SourceLink].map((i) => ({
            ...richA2uiApis[i.name as keyof typeof richA2uiApis],
            ...i,
          })),
        ]
      : implementations,
    [],
  );
}
