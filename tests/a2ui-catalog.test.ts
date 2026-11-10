import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { Catalog } from "@a2ui/web_core/v0_9";
import { A2uiRuntime } from "../web/a2ui.js";
import { a2uiApis } from "../shared/a2ui-catalog.js";
import {
  A2UI_CATALOG_ID,
  A2UI_LIMITS,
  A2uiInputError,
  assertA2uiBudget,
  decodeA2ui,
  encodeA2ui,
} from "../shared/a2ui-policy.js";
import {
  demoMessages,
  demoActions,
  demoSurfaceId,
} from "../examples/a2ui/catalog-fixture.js";

const catalog = () =>
  new Catalog(A2UI_CATALOG_ID, "0.9", Object.values(a2uiApis), []);
const make = (
  onAction: ConstructorParameters<typeof A2uiRuntime>[1]["onAction"] = () => {},
) =>
  new A2uiRuntime(catalog(), {
    surfaceId: demoSurfaceId,
    allowedActions: demoActions,
    onAction,
  });
const data = (path: string, value?: unknown) => ({
  version: "v0.9",
  updateDataModel: { surfaceId: demoSurfaceId, path, value },
});
const update = (components: unknown[]) => ({
  version: "v0.9",
  updateComponents: { surfaceId: demoSurfaceId, components },
});
const rejects = (action: () => void, code?: string) =>
  assert.throws(
    action,
    (e) => e instanceof A2uiInputError && (!code || e.code === code),
  );

test("A2UI product catalog contains six components and no executable functions", () => {
  const c = catalog(),
    json = c.toJson();
  assert.deepEqual([...c.components.keys()].sort(), [
    "Button",
    "ChoicePicker",
    "Column",
    "Row",
    "Text",
    "TextField",
  ]);
  assert.equal(c.functions.size, 0);
  assert.equal(json.catalogId, A2UI_CATALOG_ID);
  assert.deepEqual(
    Object.keys(json.components as object).sort(),
    [...c.components.keys()].sort(),
  );
});
test("A2UI ordinary form renders a complete native state and preserves user edits on incremental updates", () => {
  const runtime = make();
  try {
    runtime.apply(encodeA2ui(demoMessages()));
    const original = runtime.surface;
    original!.dataModel.set("/name", "user-edited");
    runtime.apply(encodeA2ui(data("/status", "updated")));
    assert.strictEqual(runtime.surface, original);
    assert.equal(runtime.surface!.dataModel.get("/name"), "user-edited");
    assert.equal(runtime.surface!.dataModel.get("/status"), "updated");
  } finally {
    runtime.dispose();
  }
});
test("A2UI byte, array, string, property and structural depth limits reject before schemas", () => {
  rejects(
    () => decodeA2ui(" ".repeat(A2UI_LIMITS.bytes + 1)),
    "RESOURCE_LIMIT",
  );
  rejects(
    () => decodeA2ui(JSON.stringify(data("/name", "字".repeat(24_000)))),
    "RESOURCE_LIMIT",
  );
  rejects(
    () => decodeA2ui(JSON.stringify(data("/name", Array(65).fill(0)))),
    "RESOURCE_LIMIT",
  );
  rejects(
    () => decodeA2ui(JSON.stringify(data("/name", "a".repeat(4097)))),
    "RESOURCE_LIMIT",
  );
  rejects(
    () =>
      decodeA2ui(
        JSON.stringify(
          data(
            "/name",
            Object.fromEntries(
              Array.from({ length: 33 }, (_, i) => [`k${i}`, 1]),
            ),
          ),
        ),
      ),
    "RESOURCE_LIMIT",
  );
  let deep: unknown = "leaf";
  for (let i = 0; i < 18; i++) deep = { nested: deep };
  rejects(
    () => decodeA2ui(JSON.stringify(data("/name", deep))),
    "RESOURCE_LIMIT",
  );
  const manyValues = Array.from({ length: 64 }, () => Array(64).fill(0));
  rejects(
    () => decodeA2ui(JSON.stringify(data("/name", manyValues))),
    "RESOURCE_LIMIT",
  );
});
test("A2UI oversized invalid collection never reaches the legacy component schema", () => {
  const runtime = make(),
    schema = a2uiApis.Text.schema,
    original = schema.safeParse;
  let calls = 0;
  schema.safeParse = (...args: Parameters<typeof original>) => {
    ++calls;
    return original.apply(schema, args);
  };
  try {
    const messages = demoMessages();
    messages[2] = update([
      {
        id: "root",
        component: "Text",
        text: Array(65).fill({ invalid: true }),
      },
    ]) as (typeof messages)[2];
    rejects(() => runtime.apply(JSON.stringify(messages)), "RESOURCE_LIMIT");
    assert.equal(calls, 0);
    assert.equal(runtime.surface, undefined);
  } finally {
    schema.safeParse = original;
    runtime.dispose();
  }
});
test("A2UI advisory-shaped oversized collections are bounded in a 64 MiB child process", () => {
  const result = execFileSync(
    process.execPath,
    [
      "--max-old-space-size=64",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import {decodeA2ui,A2uiInputError} from './shared/a2ui-policy.ts';
    for(const n of [65,1000,200000]) {
      try { decodeA2ui(JSON.stringify({version:'v0.9',updateComponents:{surfaceId:'monitor-demo',components:Array(n).fill({invalid:true})}})); process.exit(2); }
      catch(e) { if(!(e instanceof A2uiInputError) || e.code!=='RESOURCE_LIMIT') throw e; }
    }
    console.log('bounded');
  `,
    ],
    { timeout: 10_000, encoding: "utf8" },
  );
  assert.equal(result.trim(), "bounded");
});
test("A2UI rejects malformed JSON, unknown versions, catalogs, extra fields and empty batches", () => {
  for (const raw of [
    "{bad",
    "[]",
    JSON.stringify({
      version: "v0.9.1",
      deleteSurface: { surfaceId: demoSurfaceId },
    }),
    JSON.stringify({
      version: "v0.9",
      createSurface: {
        surfaceId: demoSurfaceId,
        catalogId: "https://example.invalid/catalog",
      },
    }),
    JSON.stringify({
      version: "v0.9",
      deleteSurface: { surfaceId: demoSurfaceId },
      execute: true,
    }),
  ])
    rejects(() => decodeA2ui(raw));
});
test("A2UI forbids prototype keys, dangerous pointers and large automatic array indices", () => {
  for (const path of [
    "/__proto__/polluted",
    "/constructor/prototype",
    "/array/64",
    "/array/1000000",
    "/array/-",
    "/bad~2key",
    "/a/b/c/d/e/f/g/h/i",
    "/array/00",
  ])
    rejects(() => decodeA2ui(JSON.stringify(data(path, 1))), "INVALID_MESSAGE");
  rejects(
    () =>
      decodeA2ui(
        '{"version":"v0.9","updateDataModel":{"surfaceId":"monitor-demo","value":{"__proto__":{"polluted":true}}}}',
      ),
    "FORBIDDEN_KEY",
  );
  let touched = false;
  rejects(
    () =>
      assertA2uiBudget(
        Object.defineProperty({}, "field", {
          enumerable: true,
          get() {
            touched = true;
            return "bad";
          },
        }),
      ),
    "INVALID_JSON",
  );
  assert.equal(touched, false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
test("A2UI invalid component changes fail atomically without replacing current input or surface", () => {
  const bad = [
    { id: "title", component: "Image", url: "https://example.invalid/x" },
    { id: "title", component: "Text", text: "hi", onClick: "alert(1)" },
    {
      id: "title",
      component: "Text",
      text: { call: "eval", args: { code: "alert(1)" } },
    },
    {
      id: "name",
      component: "TextField",
      label: "输入",
      variant: "obscured",
      value: { path: "/name" },
    },
    {
      id: "name",
      component: "TextField",
      label: "输入",
      value: { path: "/name" },
      validationRegexp: "(a+)+$",
    },
    {
      id: "submit",
      component: "Button",
      child: "submit-label",
      action: { event: { name: "shell.run", context: {} } },
    },
    {
      id: "submit",
      component: "Button",
      child: "submit-label",
      action: {
        functionCall: {
          call: "openUrl",
          args: { url: "https://example.invalid" },
        },
      },
    },
  ];
  const runtime = make();
  try {
    runtime.apply(encodeA2ui(demoMessages()));
    const original = runtime.surface;
    original!.dataModel.set("/name", "unsent-user-value");
    for (const component of bad) {
      rejects(() =>
        runtime.apply(
          encodeA2ui([data("/name", "must-not-apply"), update([component])]),
        ),
      );
      assert.strictEqual(runtime.surface, original);
      assert.equal(
        runtime.surface!.dataModel.get("/name"),
        "unsent-user-value",
      );
    }
  } finally {
    runtime.dispose();
  }
});
test("A2UI rejects cycles, repeated children, shared parents, orphans and excessive tree depth", () => {
  const bad = [
    [{ id: "root", component: "Column", children: ["root"] }],
    [
      { id: "root", component: "Column", children: ["leaf", "leaf"] },
      { id: "leaf", component: "Text", text: "same" },
    ],
    [
      { id: "root", component: "Column", children: ["row", "leaf"] },
      { id: "row", component: "Row", children: ["leaf"] },
      { id: "leaf", component: "Text", text: "same" },
    ],
    [
      { id: "root", component: "Text", text: "root" },
      { id: "orphan", component: "Text", text: "orphan" },
    ],
    Array.from({ length: 13 }, (_, index) => ({
      id: index === 0 ? "root" : `node${index}`,
      component: index === 12 ? "Text" : "Column",
      ...(index === 12
        ? { text: "too deep" }
        : { children: [`node${index + 1}`] }),
    })),
  ];
  for (const components of bad) {
    const runtime = make();
    try {
      rejects(
        () =>
          runtime.apply(encodeA2ui([demoMessages()[0], update(components)])),
        "INVALID_TREE",
      );
      assert.equal(runtime.surface, undefined);
    } finally {
      runtime.dispose();
    }
  }
});
test("A2UI parent and child policies disallow interactive controls inside buttons", () => {
  const runtime = make();
  try {
    rejects(
      () =>
        runtime.apply(
          encodeA2ui([
            demoMessages()[0],
            update([
              {
                id: "root",
                component: "Button",
                child: "field",
                action: { event: { name: "monitor.submit", context: {} } },
              },
              {
                id: "field",
                component: "TextField",
                label: "nested",
                value: "bad",
              },
            ]),
          ]),
        ),
      "INVALID_SURFACE",
    );
    assert.equal(runtime.surface, undefined);
  } finally {
    runtime.dispose();
  }
});
test("A2UI accumulated state cannot grow past the component or byte budget", () => {
  const runtime = make();
  try {
    runtime.apply(
      encodeA2ui([
        demoMessages()[0],
        update([{ id: "root", component: "Column", children: [] }]),
      ]),
    );
    for (let i = 0; i < 12; i++)
      runtime.apply(encodeA2ui(data(`/item${i}`, "a".repeat(4096))));
    const original = runtime.surface;
    let rejected = false;
    for (let i = 12; i < 20; i++) {
      try {
        runtime.apply(encodeA2ui(data(`/item${i}`, "a".repeat(4096))));
      } catch (e) {
        assert.ok(e instanceof A2uiInputError);
        rejected = true;
        break;
      }
    }
    assert.equal(rejected, true);
    assert.strictEqual(runtime.surface, original);
    assert.equal(runtime.surface!.dataModel.get("/item19"), undefined);
  } finally {
    runtime.dispose();
  }
});
test("A2UI invalid bound types and unsupported choices cannot silently change current selection", () => {
  const runtime = make();
  try {
    runtime.apply(encodeA2ui(demoMessages()));
    for (const message of [
      data("/server", ["missing"]),
      data("/server", ["host-a", "host-b"]),
      data("/metrics", ["cpu", "cpu"]),
      data("/name", { unsafe: "value" }),
    ])
      rejects(() => runtime.apply(encodeA2ui(message)));
    assert.deepEqual(runtime.surface!.dataModel.get("/server"), ["host-a"]);
    runtime.apply(encodeA2ui(data("/notes", "<script>inert</script>")));
    assert.equal(
      runtime.surface!.dataModel.get("/notes"),
      "<script>inert</script>",
    );
  } finally {
    runtime.dispose();
  }
});
test("A2UI component quota applies across incremental updates", () => {
  const runtime = make();
  const components = [
    { id: "root", component: "Column", children: ["a", "b", "c"] },
    ...["a", "b", "c"].flatMap((group) => [
      {
        id: group,
        component: "Column",
        children: Array.from({ length: 20 }, (_, i) => `${group}${i}`),
      },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `${group}${i}`,
        component: "Text",
        text: "leaf",
      })),
    ]),
  ];
  try {
    runtime.apply(encodeA2ui([demoMessages()[0], update(components)]));
    const original = runtime.surface;
    rejects(
      () =>
        runtime.apply(
          encodeA2ui(
            update([
              {
                id: "c",
                component: "Column",
                children: [
                  ...Array.from({ length: 20 }, (_, i) => `c${i}`),
                  "extra",
                ],
              },
              { id: "extra", component: "Text", text: "over quota" },
            ]),
          ),
        ),
      "RESOURCE_LIMIT",
    );
    assert.strictEqual(runtime.surface, original);
  } finally {
    runtime.dispose();
  }
});
test("A2UI labels cannot be blank and buttons require nonempty phrasing text", () => {
  const runtime = make();
  try {
    runtime.apply(encodeA2ui(demoMessages()));
    for (const component of [
      {
        id: "name",
        component: "TextField",
        label: "  ",
        value: { path: "/name" },
      },
      { id: "submit-label", component: "Text", text: " " },
      { id: "submit-label", component: "Text", text: "heading", variant: "h3" },
    ])
      rejects(() => runtime.apply(encodeA2ui(update([component]))));
    assert.equal(runtime.surface!.dataModel.get("/name"), "资源监控");
  } finally {
    runtime.dispose();
  }
});
test("A2UI delete, wrong-surface and disposed runtimes reject late changes", () => {
  const runtime = make();
  runtime.apply(encodeA2ui(demoMessages()));
  rejects(
    () =>
      runtime.apply(
        encodeA2ui({
          version: "v0.9",
          updateDataModel: {
            surfaceId: "other",
            path: "/name",
            value: "wrong",
          },
        }),
      ),
    "SURFACE_MISMATCH",
  );
  runtime.apply(
    encodeA2ui({
      version: "v0.9",
      deleteSurface: { surfaceId: demoSurfaceId },
    }),
  );
  rejects(
    () => runtime.apply(encodeA2ui(data("/name", "late"))),
    "SURFACE_MISSING",
  );
  runtime.dispose();
  rejects(() => runtime.apply(encodeA2ui(demoMessages())), "DISPOSED");
});
test("A2UI action allowlist, one pending submission and failure cleanup remain local", async () => {
  let count = 0,
    release: (() => void) | undefined;
  const runtime = make(async () => {
    ++count;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  try {
    runtime.apply(encodeA2ui(demoMessages()));
    const pending = runtime.surface!.dispatchAction(
      { event: { name: "monitor.submit", context: {} } },
      "submit",
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.busy, true);
    await runtime.surface!.dispatchAction(
      { event: { name: "monitor.submit", context: {} } },
      "submit",
    );
    assert.equal(count, 1);
    release!();
    await pending;
    assert.equal(runtime.busy, false);
    await runtime.surface!.dispatchAction(
      { event: { name: "shell.run", context: {} } },
      "submit",
    );
    assert.equal(count, 1);
  } finally {
    runtime.dispose();
  }
});
test("A2UI oversized resolved action contexts never reach a consumer", async () => {
  let count = 0;
  const runtime = make(() => {
    ++count;
  });
  try {
    runtime.apply(encodeA2ui(demoMessages()));
    await runtime.surface!.dispatchAction(
      {
        event: {
          name: "monitor.submit",
          context: { values: Array(65).fill("oversized") },
        },
      },
      "submit",
    );
    assert.equal(count, 0);
    assert.equal(runtime.busy, false);
    assert.match(runtime.error, /未能提交/);
  } finally {
    runtime.dispose();
  }
});

test("A2UI server field reconstruction rejects conflicting overlapping bindings atomically", () => {
  const runtime = make();
  try {
    runtime.apply(
      encodeA2ui([
        demoMessages()[0],
        data("/selection", ["a"]),
        update([
          { id: "root", component: "Column", children: ["picker", "field"] },
          {
            id: "picker",
            component: "ChoicePicker",
            label: "选择",
            value: { path: "/selection" },
            options: [
              { label: "A", value: "a" },
              { label: "B", value: "b" },
            ],
          },
          {
            id: "field",
            component: "TextField",
            label: "同一值",
            value: { path: "/selection/0" },
          },
        ]),
      ]),
    );
    rejects(
      () => runtime.updateValues({ picker: ["a"], field: "b" }),
      "INVALID_FIELDS",
    );
    assert.deepEqual(runtime.values(), { picker: ["a"], field: "a" });
    runtime.updateValues({ picker: ["b"], field: "b" });
    assert.deepEqual(runtime.values(), { picker: ["b"], field: "b" });
  } finally {
    runtime.dispose();
  }
});
