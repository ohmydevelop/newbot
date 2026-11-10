import {
  MessageProcessor,
  DataModel,
  type ActionPayload,
  type Catalog,
  type ComponentApi,
} from "@a2ui/web_core/v0_9";
import { a2uiApis } from "./a2ui-catalog.js";
import {
  A2UI_CATALOG_ID,
  A2UI_LIMITS,
  decodeA2ui,
  encodeA2ui,
  failA2ui,
  type A2uiMessage,
} from "./a2ui-policy.js";

type Component = Record<string, unknown>;
type State = { components: Map<string, Component> } | null;
export class A2uiRuntime<T extends ComponentApi = ComponentApi> {
  #processor: MessageProcessor<T>;
  #state: State = null;
  #listeners = new Set<() => void>();
  #disposed = false;
  #revision = 0;
  #busy = false;
  #error = "";
  #allowed: ReadonlySet<string>;
  constructor(
    readonly catalog: Catalog<T>,
    readonly options: {
      surfaceId: string;
      allowedActions: readonly string[];
      onAction: (action: ActionPayload) => void | Promise<void>;
    },
  ) {
    this.#allowed = new Set(options.allowedActions);
    this.#processor = this.#createProcessor(async (action) => {
      if (this.#disposed || this.#busy) return;
      const source = this.#state?.components.get(action.sourceComponentId);
      if (
        action.surfaceId !== options.surfaceId ||
        source?.component !== "Button" ||
        !this.#allowed.has(action.name) ||
        (source.action as { event: { name: string } }).event.name !==
          action.name
      )
        return;
      // Recheck resolved bindings: a small context expression can otherwise
      // produce a much larger output than the original description.
      try {
        const safeAction = JSON.parse(encodeA2ui(action)) as ActionPayload;
        this.#busy = true;
        this.#error = "";
        this.#notify();
        await options.onAction(safeAction);
      } catch {
        if (!this.#disposed) this.#error = "操作未能提交，请重试。";
      } finally {
        if (!this.#disposed) {
          this.#busy = false;
          this.#notify();
        }
      }
    });
  }
  #createProcessor(action?: (action: ActionPayload) => void | Promise<void>) {
    return new MessageProcessor<T>([this.catalog], action, {
      version: "v0.9",
      validationConfig: {
        targetVersion: "v0.9",
        maxDepth: A2UI_LIMITS.treeDepth,
      },
    });
  }
  get revision() {
    return this.#revision;
  }
  get busy() {
    return this.#busy;
  }
  get error() {
    return this.#error;
  }
  get surface() {
    return this.#disposed
      ? undefined
      : this.#processor.model.surfacesMap.get(this.options.surfaceId);
  }
  subscribe = (listener: () => void) => {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #notify() {
    ++this.#revision;
    for (const listener of this.#listeners) listener();
  }
  #snapshot(): A2uiMessage[] {
    if (!this.#state) return [];
    return [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: this.options.surfaceId,
          catalogId: A2UI_CATALOG_ID,
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: this.options.surfaceId,
          path: "/",
          value: this.surface!.dataModel.get("/"),
        },
      },
      ...(this.#state.components.size
        ? [
            {
              version: "v0.9" as const,
              updateComponents: {
                surfaceId: this.options.surfaceId,
                components: [...this.#state.components.values()],
              },
            },
          ]
        : []),
    ];
  }
  snapshot(): A2uiMessage[] {
    return JSON.parse(encodeA2ui(this.#snapshot()));
  }
  components(): ReadonlyMap<string, Component> {
    return new Map(this.#state?.components);
  }
  values(): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [id, component] of this.#state?.components || []) {
      if (!["TextField", "ChoicePicker"].includes(String(component.component)))
        continue;
      const binding = component.value;
      if (!binding || typeof binding !== "object" || !("path" in binding))
        continue;
      result[id] =
        this.surface!.dataModel.get(String(binding.path)) ??
        (component.component === "TextField" ? "" : []);
    }
    return JSON.parse(encodeA2ui(result));
  }
  updateValues(values: Record<string, unknown>) {
    encodeA2ui(values);
    const expected = this.values();
    if (
      Object.keys(values).length !== Object.keys(expected).length ||
      Object.keys(values).some((id) => !Object.hasOwn(expected, id))
    )
      failA2ui("INVALID_FIELDS");
    const data = new DataModel(
      JSON.parse(encodeA2ui(this.surface!.dataModel.get("/"))),
    );
    const paths = new Map<string, string>();
    try {
      for (const [id, value] of Object.entries(values)) {
        const component = this.#state!.components.get(id)!;
        if (
          component.component === "TextField"
            ? typeof value !== "string"
            : !Array.isArray(value) || value.some((v) => typeof v !== "string")
        )
          failA2ui("INVALID_FIELDS");
        const path = (component.value as { path: string }).path;
        const encoded = JSON.stringify(value);
        if (paths.has(path) && paths.get(path) !== encoded)
          failA2ui("INVALID_FIELDS");
        paths.set(path, encoded);
        data.set(path, structuredClone(value));
      }
      for (const [id, value] of Object.entries(values)) {
        const path = (
          this.#state!.components.get(id)!.value as { path: string }
        ).path;
        if (JSON.stringify(data.get(path)) !== JSON.stringify(value))
          failA2ui("INVALID_FIELDS");
      }
      this.apply(
        encodeA2ui({
          version: "v0.9",
          updateDataModel: {
            surfaceId: this.options.surfaceId,
            path: "/",
            value: data.get("/"),
          },
        }),
      );
    } finally {
      data.dispose();
    }
  }
  async dispatch(componentId: string) {
    const component = this.#state?.components.get(componentId);
    if (component?.component !== "Button" || !this.surface)
      failA2ui("INVALID_ACTION");
    // React's GenericBinder resolves these before dispatch. The server has no
    // renderer, so resolve the catalog's restricted scalar/path context here.
    const action = component.action as {
      event: { name: string; context: Record<string, unknown> };
    };
    const context = Object.fromEntries(
      Object.entries(action.event.context).map(([key, value]) => [
        key,
        value && typeof value === "object" && "path" in value
          ? this.surface!.dataModel.get(String(value.path))
          : value,
      ]),
    );
    encodeA2ui(context);
    await this.surface.dispatchAction(
      { event: { name: action.event.name, context } },
      componentId,
    );
    if (this.error) failA2ui("ACTION_FAILED");
  }
  #validateState(messages: A2uiMessage[]): State {
    let state = this.#state
      ? { components: new Map(this.#state.components) }
      : null;
    for (const message of messages) {
      const operation =
        "createSurface" in message
          ? message.createSurface
          : "updateComponents" in message
            ? message.updateComponents
            : "updateDataModel" in message
              ? message.updateDataModel
              : message.deleteSurface;
      if (operation.surfaceId !== this.options.surfaceId)
        failA2ui("SURFACE_MISMATCH");
      if ("createSurface" in message) {
        if (state) failA2ui("SURFACE_EXISTS");
        state = { components: new Map() };
      } else if (!state) failA2ui("SURFACE_MISSING");
      else if ("deleteSurface" in message) state = null;
      else if ("updateComponents" in message) {
        const ids = new Set();
        for (const component of message.updateComponents.components) {
          const { id, component: type, ...properties } = component;
          if (
            typeof id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) ||
            ids.has(id)
          )
            failA2ui("INVALID_COMPONENT");
          ids.add(id);
          if (typeof type !== "string" || !Object.hasOwn(a2uiApis, type))
            failA2ui("UNKNOWN_COMPONENT");
          const api = a2uiApis[type as keyof typeof a2uiApis];
          if (!api.schema.safeParse(properties).success)
            failA2ui("INVALID_COMPONENT");
          if (type === "Button") {
            const name = (properties.action as { event: { name: string } })
              .event.name;
            if (!this.#allowed.has(name)) failA2ui("ACTION_NOT_ALLOWED");
          }
          if (type === "ChoicePicker") {
            const values = (properties.options as { value: string }[]).map(
              (item) => item.value,
            );
            if (new Set(values).size !== values.length)
              failA2ui("INVALID_COMPONENT");
          }
          state.components.set(id, component);
        }
        if (state.components.size > A2UI_LIMITS.components)
          failA2ui("RESOURCE_LIMIT");
        assertComponentTree(state.components);
      }
    }
    return state;
  }
  apply(raw: string) {
    if (this.#disposed) failA2ui("DISPOSED");
    const messages = decodeA2ui(raw);
    const next = this.#validateState(messages);
    const saved = this.#snapshot();
    const snapshot = saved.length ? decodeA2ui(encodeA2ui(saved)) : [];
    const candidate = this.#createProcessor();
    try {
      if (snapshot.length) candidate.processMessages(snapshot);
      candidate.processMessages(messages);
      // Bound the accumulated state, including existing user-edited values.
      const surface = candidate.model.surfacesMap.get(this.options.surfaceId);
      encodeA2ui({
        components: next ? [...next.components.values()] : [],
        data: surface?.dataModel.get("/") ?? {},
      });
      if (next && surface) {
        for (const component of next.components.values()) {
          if (component.component === "Button") {
            const label = next.components.get(String(component.child))!;
            const configured = label.text;
            const value =
              configured &&
              typeof configured === "object" &&
              "path" in configured
                ? surface.dataModel.get(String(configured.path))
                : configured;
            if (
              label.component !== "Text" ||
              label.variant === "h3" ||
              typeof value !== "string" ||
              !value.trim()
            )
              failA2ui("INVALID_LABEL");
            continue;
          }
          const key = component.component === "Text" ? "text" : "value";
          const configured = component[key];
          const value =
            configured && typeof configured === "object" && "path" in configured
              ? surface.dataModel.get(String(configured.path))
              : configured;
          if (value === undefined) continue;
          if (
            ["Text", "TextField"].includes(String(component.component)) &&
            typeof value !== "string"
          )
            failA2ui("INVALID_BINDING");
          if (component.component === "ChoicePicker") {
            const choices = new Set(
              (component.options as { value: string }[]).map(
                (option) => option.value,
              ),
            );
            if (
              !Array.isArray(value) ||
              value.length > 24 ||
              new Set(value).size !== value.length ||
              value.some((item) => !choices.has(item)) ||
              (component.variant !== "multipleSelection" && value.length > 1)
            )
              failA2ui("INVALID_BINDING");
          }
        }
      }
    } catch (error) {
      // Do not expose SDK errors that can include rejected payload values.
      return failA2ui("INVALID_SURFACE");
    } finally {
      candidate.dispose();
    }
    this.#processor.processMessages(messages);
    this.#state = next;
    this.#error = "";
    this.#notify();
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#busy = false;
    this.#error = "";
    this.#state = null;
    this.#processor.dispose();
    this.#notify();
    this.#listeners.clear();
  }
}

// A DAG can expand into an exponential rendered tree. Every node has one
// parent, including repeated references in the same children array.
function assertComponentTree(components: Map<string, Component>) {
  if (!components.has("root")) failA2ui("INVALID_TREE");
  const visited = new Set<string>();
  const stack: [string, number][] = [["root", 1]];
  while (stack.length) {
    const [id, depth] = stack.pop()!;
    if (visited.has(id) || depth > A2UI_LIMITS.treeDepth)
      failA2ui("INVALID_TREE");
    visited.add(id);
    const node = components.get(id);
    if (!node) failA2ui("INVALID_TREE");
    const children =
      node.component === "Button"
        ? [node.child]
        : node.component === "Row" || node.component === "Column"
          ? (node.children as unknown[])
          : [];
    for (const child of children) {
      if (typeof child !== "string") failA2ui("INVALID_TREE");
      stack.push([child, depth + 1]);
    }
  }
  if (visited.size !== components.size) failA2ui("INVALID_TREE");
}
