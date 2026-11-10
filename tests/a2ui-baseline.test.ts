import assert from "node:assert/strict";
import { test } from "node:test";
import { A2uiMessageSchema } from "@a2ui/web_core/v0_9";
import { verifyA2uiFixtures } from "../scripts/verify-a2ui-fixtures.mjs";
import {
  applyLabMessage,
  createLabProcessor,
  sampleMessages,
  samples,
} from "../examples/a2ui/runtime.js";

test("A2UI official samples and schemas match the pinned published artifact", () => {
  assert.equal(verifyA2uiFixtures().version, "0.14.0");
});
for (const version of ["v0.9", "v0.9.1"] as const) {
  for (const id of Object.keys(samples) as (keyof typeof samples)[]) {
    test(`A2UI ${version} official ${id} messages process sequentially`, () => {
      const processor = createLabProcessor(version);
      try {
        const messages = sampleMessages(id, version);
        for (const message of messages) applyLabMessage(processor, message);
        assert.equal(processor.model.surfacesMap.size, 1);
        const surface = [...processor.model.surfacesMap.values()][0];
        // 0.14.0 accepts the 0.9.1 envelope but normalizes the surface to 0.9.
        // This does not establish full 0.9.1 outbound protocol compliance.
        assert.equal(surface.protocolVersion, "v0.9");
        if (id === "incremental")
          assert.equal(surface.dataModel.get("/restaurants").length, 4);
        applyLabMessage(processor, {
          version,
          deleteSurface: { surfaceId: surface.id },
        });
        assert.equal(processor.model.surfacesMap.size, 0);
      } finally {
        processor.dispose();
      }
    });
  }
}
test("A2UI official envelope rejects unknown operations, fields and versions", () => {
  for (const input of [
    { version: "v9.9", deleteSurface: { surfaceId: "test" } },
    { version: "v0.9.1", execute: { javascript: "alert(1)" } },
    { version: "v0.9.1", deleteSurface: { surfaceId: "test" }, extra: true },
    { version: "v0.9.1", deleteSurface: {} },
  ])
    assert.equal(A2uiMessageSchema.safeParse(input).success, false);
});
test("A2UI catalog validation rejects unknown components and executable properties", () => {
  for (const component of [
    { id: "root", component: "ArbitraryScript", text: "test" },
    { id: "root", component: "Text", text: "test", onClick: "alert(1)" },
  ]) {
    const processor = createLabProcessor("v0.9.1");
    try {
      applyLabMessage(processor, sampleMessages("text", "v0.9.1")[0]);
      assert.throws(() =>
        applyLabMessage(processor, {
          version: "v0.9.1",
          updateComponents: {
            surfaceId: "gallery-simple-text",
            components: [component],
          },
        }),
      );
    } finally {
      processor.dispose();
    }
  }
});
test("A2UI catalog identifiers cannot fetch or register remote catalogs", () => {
  const processor = createLabProcessor("v0.9.1");
  try {
    assert.throws(() =>
      applyLabMessage(processor, {
        version: "v0.9.1",
        createSurface: {
          surfaceId: "unregistered",
          catalogId: "https://example.invalid/catalog.json",
        },
      }),
    );
    assert.equal(processor.model.surfacesMap.size, 0);
  } finally {
    processor.dispose();
  }
});
test("A2UI mutations after deletion fail without resurrecting the surface", () => {
  const processor = createLabProcessor("v0.9.1");
  try {
    const messages = sampleMessages("text", "v0.9.1");
    processor.processMessages(messages);
    applyLabMessage(processor, {
      version: "v0.9.1",
      deleteSurface: { surfaceId: "gallery-simple-text" },
    });
    assert.throws(() => applyLabMessage(processor, messages[1]));
    assert.equal(processor.model.surfacesMap.size, 0);
  } finally {
    processor.dispose();
  }
});
