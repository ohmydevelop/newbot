import { test } from "node:test";
import assert from "node:assert/strict";
import { connectorCatalogNames } from "../web/connector-catalog.js";

test("independent connector membership is stable before discovery and late plugin metadata", () => {
  const configured = [
    { id: "independent" },
    { id: "plugin_legitimate_user_name" },
  ];
  // Previously a runtime-only component became a row until plugin/list resolved.
  const phases = [
    [],
    [{ name: "plugin_internal", pluginId: null }],
    [{ name: "plugin_internal", pluginId: "bundle@market" }],
    [],
  ];
  for (const discovered of phases) {
    const settings = { configuration: { mcp: configured }, mcp: discovered };
    assert.deepEqual(connectorCatalogNames(settings.configuration.mcp), [
      "independent",
      "plugin_legitimate_user_name",
    ]);
  }
  assert.deepEqual(connectorCatalogNames(undefined), []);
  assert.deepEqual(
    connectorCatalogNames(configured, ["plugin_internal"]),
    ["plugin_internal"],
    "plugin detail shows declared components even before discovery",
  );
});
