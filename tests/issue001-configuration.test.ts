import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigCodex } from "./config-fixture.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { createServer } from "../server/index.js";
import type { ConfigurationView } from "../shared/configuration.js";
import {
  credentialFixture,
  credentialTestSecret,
} from "./credential-fixture.js";

test("connector creation depends on absence, edits on its own revision, and lost save responses have one receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-issue001-"));
  const codex = new ConfigCodex();
  codex.config = { model_providers: {}, mcp_servers: {} };
  const providerRuntime = new ProviderRuntime({
    model_providers: {
      sample: {
        name: "Sample",
        base_url: "https://example.test/v1",
        wire_api: "responses",
      },
    },
  });
  const origin = "http://127.0.0.1:3100";
  const c = await createServer({
    directory,
    cwd: join(directory, "work"),
    codex,
    providerRuntime,
    origins: [origin],
    password: "issue001-test-password",
  });
  try {
    const login = await c.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "issue001-test-password" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const read = async () =>
      (await c.app.inject({ url: "/api/config?view=saved", headers })).json()
        .configuration;
    const post = (payload: object, operation = randomUUID()) =>
      c.app.inject({
        method: "POST",
        url: "/api/config",
        headers: { ...headers, "x-newbot-operation-id": operation },
        payload,
      });
    const before = await read();
    assert.equal(
      before.providers[0].editableEndpoint,
      "https://example.test/v1",
    );
    const renamed = await post({
      action: "provider/save",
      id: "sample",
      create: false,
      expectedRevision: before.revisions["provider:sample"],
      patch: { name: "Renamed" },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    const operation = randomUUID();
    const create = {
      action: "mcp/save",
      id: "fresh",
      create: true,
      transport: "http",
      expectedRevision: before.revision,
      patch: { name: "Fresh connector", url: "https://mcp.example.test/mcp" },
    };
    const [one, repeated] = await Promise.all([
      post(create, operation),
      post(create, operation),
    ]);
    assert.equal(one.statusCode, 200, one.body);
    assert.deepEqual(repeated.json(), one.json());
    const receipt = await c.app.inject({
      url: `/api/config/operations/${operation}`,
      headers,
    });
    assert.equal(receipt.json().state, "saved");
    assert.deepEqual(
      receipt.json().result.configuration,
      one.json().configuration,
    );
    assert.equal(
      (await post(create)).statusCode,
      409,
      "different operation must not replace the created object",
    );
    const revision = one.json().configuration.revisions["mcp:fresh"];
    const edit = (name: string) =>
      post({
        ...create,
        create: false,
        expectedRevision: revision,
        patch: { name },
      });
    const edits = await Promise.all([edit("First"), edit("Stale")]);
    assert.deepEqual(edits.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(
      (await read()).mcp.find((m: any) => m.id === "fresh").name,
      "First",
    );
    assert.equal(
      codex.calls.filter((call) =>
        ["thread/resume", "turn/start"].includes(call.method),
      ).length,
      0,
    );
  } finally {
    await c.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("saved views and mutation receipts preserve legacy authentication; omitted fields cannot erase it", async () => {
  const c = await credentialFixture();
  const post = (url: string, payload: object) =>
    c.app.inject({ method: "POST", url, headers: c.headers, payload });
  try {
    let view: ConfigurationView = (await c.service.settings(false)).configuration!;
    const provider = () => view.providers.find((p) => p.id === "secondary")!;
    const ticket = await post("/api/credentials/requests", {
      requestId: randomUUID(),
      operation: "credential.save",
      scope: "provider",
      targetId: "secondary",
      retention: "encrypted",
      expectedRevision: view.revision,
      expectedVaultVersion: provider().managedCredential!.version,
    });
    assert.equal(ticket.statusCode, 200, ticket.body);
    assert.equal((await c.input(ticket.json().id)).json().state, "succeeded");
    view = await c.service.providerConfiguration();
    assert.equal(provider().managedCredential?.stored, true);
    assert.deepEqual(provider().authentication, {source:"managed",state:"saved"});
    const saved = await post("/api/config", {
      action: "provider/save",
      id: "secondary",
      create: false,
      expectedRevision: view.revisions!["provider:secondary"],
      patch: { name: "Renamed safely" },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    view = saved.json().configuration;
    assert.equal(provider().managedCredential?.stored, true);
    assert.deepEqual(provider().authentication, {source:"managed",state:"saved"});
    // Exercise the in-memory private transport after migrating a legacy native entry.
    c.codex.privateConfiguration = c.privateFields.inject;
    const fields = await post("/api/credentials/requests", {
      operation: "credential.fields.save",
      requestId: randomUUID(),
      scope: "provider",
      targetId: "secondary",
      expectedRevision: view.revisions!["provider:secondary"],
      expectedFieldsRevision: "absent",
      fields: [],
    });
    assert.equal(fields.statusCode, 200, fields.body);
    const result = await c.input(
      fields.json().id,
      Buffer.from("{}").toString("base64"),
    );
    assert.equal(result.json().state, "succeeded", result.body);
    view = await c.service.providerConfiguration();
    assert.deepEqual(provider().privateFields?.fields, [
      { kind: "bearer", name: "Authorization", stored: true },
    ]);
    assert.ok(!JSON.stringify(view).includes(credentialTestSecret));
    const removed = await post("/api/credentials/requests", {
      operation: "credential.fields.save",
      requestId: randomUUID(),
      scope: "provider",
      targetId: "secondary",
      expectedRevision: view.revisions!["provider:secondary"],
      expectedFieldsRevision: provider().privateFields!.revision,
      fields: [],
      removeFields: [{ kind: "bearer", name: "Authorization" }],
    });
    assert.equal(
      (
        await c.input(removed.json().id, Buffer.from("{}").toString("base64"))
      ).json().state,
      "succeeded",
    );
    view = await c.service.providerConfiguration();
    assert.deepEqual(provider().privateFields?.fields, []);
    assert.deepEqual(provider().authentication, {source:"none",state:"none"});
  } finally {
    await c.close();
  }
});
