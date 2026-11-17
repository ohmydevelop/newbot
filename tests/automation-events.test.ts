import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { eventTriggerSchema } from "../shared/automations.js";

const current = () => ({
  id: randomUUID(),
  source: "subscription",
  providerId: "a".repeat(64),
  connectionId: randomUUID(),
  events: ["message.received"],
  arguments: {},
});
for (const source of ["github", "openclaw", "hermes", "webhook"])
  test(`current contract rejects fixed source ${source}`, () => {
    assert.equal(
      eventTriggerSchema.safeParse({ ...current(), source }).success,
      false,
    );
  });
for (const key of ["providerId", "connectionId", "events", "arguments"])
  test(`current contract requires ${key}; no historical field substitution`, () => {
    const input: Record<string, unknown> = {
      ...current(),
      repository: "owner/repo",
    };
    delete input[key];
    assert.equal(eventTriggerSchema.safeParse(input).success, false);
  });
test("API cannot save obsolete or incomplete sources; retired endpoints are absent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "event-contract-"));
  const origin = "http://localhost:3100";
  const ctx = await createServer({
    directory,
    cwd: join(directory, "work"),
    codex: new FakeCodex(),
    providerRuntime: null,
    password: "event-contract-test",
    origins: [origin],
    automationTimer: false,
  });
  try {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "event-contract-test" },
    });
    const headers = {
      origin,
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    for (const trigger of [
      { ...current(), source: "github" },
      { ...current(), arguments: undefined },
      { ...current(), events: [] },
    ]) {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/automations/save",
        headers,
        payload: {
          id: randomUUID(),
          expectedRevision: 0,
          content: {
            name: "invalid",
            prompt: "test",
            triggers: [],
            eventTriggers: [trigger],
          },
        },
      });
      assert.equal(response.statusCode, 400, response.body);
    }
    assert.equal(ctx.automations.list().length, 0);
    for (const url of [
      "/api/automations/event-settings",
      `/api/automation-hooks/${randomUUID()}/${randomUUID()}`,
    ]) {
      const response = await ctx.app.inject({
        method: "POST",
        url,
        headers,
        payload: {},
      });
      assert.equal(response.statusCode, 404, response.body);
    }
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
