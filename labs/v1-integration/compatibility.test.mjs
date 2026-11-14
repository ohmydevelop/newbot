// Protocol/package probes, not real Codex execution or browser acceptance.
import assert from "node:assert/strict";
import { test } from "node:test";

// Fail if runtime imports or requests attempt to contact cloud services.
// npm/package retrieval happens separately, outside this process.
const outbound = [];
globalThis.fetch = async (input) => {
  outbound.push(String(input));
  throw new Error("External fetch forbidden in the compatibility probe");
};
const { CopilotRuntime, AgentRunner, createCopilotRuntimeHandler } =
  await import("@copilotkit/runtime/v2");
const { AbstractAgent, EventType } = await import("@ag-ui/client");
const { of } = await import("rxjs");
const { MessageProcessor } = await import("@a2ui/web_core/processing");
const { basicCatalogV1 } = await import("@copilotkit/a2ui-renderer");

// This fixture observes the SDK's routing contract. It is deliberately not
// a Newbot adapter, persistent runner, authorization layer or model emulator.
class RegistrationOnlyAgent extends AbstractAgent {
  run() {
    throw new Error("A second agent loop must not run");
  }
}
class RecordingRunner extends AgentRunner {
  calls = [];
  run({ threadId, input }) {
    this.calls.push({ operation: "run", threadId, runId: input.runId });
    return of(
      { type: EventType.RUN_STARTED, threadId, runId: input.runId },
      { type: EventType.RUN_FINISHED, threadId, runId: input.runId },
    );
  }
  connect({ threadId }) {
    this.calls.push({ operation: "connect", threadId });
    return of({ type: EventType.MESSAGES_SNAPSHOT, messages: [] });
  }
  async isRunning() {
    return false;
  }
  async stop() {
    return false;
  }
}
const input = {
  threadId: "probe-thread",
  runId: "probe-run",
  messages: [],
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
};
function setup(extra = {}) {
  const runner = new RecordingRunner();
  const handler = createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: { newbot: new RegistrationOnlyAgent() },
      runner,
      ...extra,
    }),
    basePath: "/copilot",
  });
  const request = (path, body) =>
    handler(
      new Request(
        `http://localhost/copilot/${path}`,
        body
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {},
      ),
    );
  return { runner, request };
}

test("self-hosted Runtime exposes SSE mode with telemetry disabled", async () => {
  const { request } = setup();
  const response = await request("info");
  assert.equal(response.status, 200);
  const info = await response.json();
  assert.equal(info.mode, "sse");
  assert.equal(info.telemetryDisabled, true);
  assert.ok(info.agents.newbot);
  assert.deepEqual(outbound, []);
});

test("official HTTP handler separates run and reconnect without another agent loop", async () => {
  const { runner, request } = setup();
  const run = await request("agent/newbot/run", input);
  assert.equal(run.status, 200);
  assert.match(run.headers.get("content-type"), /text\/event-stream/);
  assert.match(await run.text(), /RUN_FINISHED/);
  // CopilotKit 1.88 connect requires a RunAgentInput shape, not only threadId.
  for (let attempt = 0; attempt < 2; attempt++) {
    const connected = await request("agent/newbot/connect", input);
    assert.equal(connected.status, 200);
    assert.match(await connected.text(), /MESSAGES_SNAPSHOT/);
  }
  assert.deepEqual(
    runner.calls.map((c) => c.operation),
    ["run", "connect", "connect"],
  );
  assert.deepEqual(outbound, []);
});

test("identity-enabled Runtime refuses a runner without ownership enforcement", async () => {
  const { runner, request } = setup({
    identifyUser: () => ({ id: "probe-user" }),
  });
  for (const operation of ["run", "connect"]) {
    const response = await request(`agent/newbot/${operation}`, input);
    // This is server misconfiguration, not a normal user access denial.
    assert.equal(response.status, 500);
    assert.match(await response.text(), /ownership|isThreadAccessible/i);
  }
  assert.deepEqual(runner.calls, []);
});

test("official core and CopilotKit catalog accept A2UI 1.0 incremental state and deletion", () => {
  const processor = new MessageProcessor([basicCatalogV1], undefined, {
    version: "v1.0",
  });
  try {
    processor.processMessages({
      version: "1.0",
      createSurface: {
        surfaceId: "probe",
        catalogId: basicCatalogV1.id,
      },
    });
    processor.processMessages({
      version: "1.0",
      updateComponents: {
        surfaceId: "probe",
        components: [
          { id: "root", component: "Text", text: { "@path": "/title" } },
        ],
      },
    });
    const surface = processor.model.getSurface("probe");
    assert.ok(surface.componentsModel.has("root"));
    for (const title of ["First", "Updated"]) {
      processor.processMessages({
        version: "1.0",
        updateDataModel: {
          surfaceId: "probe",
          path: "/title",
          value: title,
        },
      });
      assert.equal(surface.dataModel.get("/title"), title);
    }
    processor.processMessages({
      version: "1.0",
      deleteSurface: { surfaceId: "probe" },
    });
    assert.equal(processor.model.getSurface("probe"), undefined);
  } finally {
    processor.model.dispose();
  }
});

test("A2UI 1.0 rejects an unavailable catalog instead of accepting arbitrary components", () => {
  const processor = new MessageProcessor([basicCatalogV1], undefined, {
    version: "v1.0",
  });
  try {
    assert.throws(() =>
      processor.processMessages({
        version: "1.0",
        createSurface: {
          surfaceId: "untrusted",
          catalogId: "https://invalid.example/unregistered.json",
        },
      }),
    );
    assert.equal(processor.model.getSurface("untrusted"), undefined);
  } finally {
    processor.model.dispose();
  }
});
