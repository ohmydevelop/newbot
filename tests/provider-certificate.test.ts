import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as httpsServer } from "node:https";
import { connect } from "node:tls";
import { inspectCertificate } from "../server/certificates.js";
import { providerFetcher } from "../server/provider-fetch.js";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
import { pluginCertificateAddress } from "../web/certificate-draft.js";

export function certificateFixture(privateIssuer = false) {
  const root = mkdtempSync(join(tmpdir(), "newbot-provider-tls-"));
  for (const name of ["server", "other"])
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(root, name + ".key"),
        "-out",
        join(root, name + ".pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
      ],
      { stdio: "ignore" },
    );
  if (privateIssuer) {
    writeFileSync(
      join(root, "ext"),
      "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n",
    );
    execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-key",
        join(root, "server.key"),
        "-out",
        join(root, "server.csr"),
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        join(root, "server.csr"),
        "-CA",
        join(root, "other.pem"),
        "-CAkey",
        join(root, "other.key"),
        "-CAcreateserial",
        "-out",
        join(root, "server.pem"),
        "-days",
        "1",
        "-extfile",
        join(root, "ext"),
      ],
      { stdio: "ignore" },
    );
  }
  return {
    root,
    cert: readFileSync(join(root, "server.pem"), "utf8"),
    other: readFileSync(join(root, "other.pem"), "utf8"),
    key: readFileSync(join(root, "server.key"), "utf8"),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("provider trust is scoped to one HTTPS operation, with domain/CA/redirect failures preserved", async () => {
  const f = certificateFixture();
  let calls = 0;
  const server = httpsServer({ key: f.key, cert: f.cert }, (req, res) => {
    calls++;
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/models" });
      res.end();
    } else {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "tls-model" }] }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `https://localhost:${(server.address() as any).port}`;
  const clients = [
    providerFetcher({ base_url: origin }),
    providerFetcher({ base_url: origin, tls_ca_certificate: f.cert }),
    providerFetcher({ base_url: origin, tls_ca_certificate: f.other }),
    providerFetcher({
      base_url: origin.replace("localhost", "127.0.0.1"),
      tls_ca_certificate: f.cert,
    }),
  ];
  try {
    await assert.rejects(clients[0].fetch(origin + "/models", {}));
    assert.equal(calls, 0);
    assert.equal(
      (await (await clients[1].fetch(origin + "/models", {})).json()).data[0]
        .id,
      "tls-model",
    );
    await assert.rejects(clients[2].fetch(origin + "/models", {}));
    await assert.rejects(
      clients[3].fetch(
        origin.replace("localhost", "127.0.0.1") + "/models",
        {},
      ),
    );
    await assert.rejects(clients[1].fetch(origin + "/redirect", {}));
    assert.equal(calls, 2);
    await assert.rejects(
      clients[1].fetch("https://different.example/models", {}),
      /其他/,
    );
    await assert.rejects(clients[0].fetch(origin + "/models", {}));
    assert.throws(
      () =>
        providerFetcher({
          base_url: "http://localhost",
          tls_ca_certificate: f.cert,
        }),
      /HTTPS/,
    );
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await new Promise<void>((r) => server.close(() => r()));
    f.close();
  }
});

test("private CA supports upload; acquisition uses a linked root or explicitly requires the missing CA", async () => {
  const f = certificateFixture(true);
  const server = httpsServer({ key: f.key, cert: f.cert }, (_req, res) =>
    res.end("private-issuer"),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `https://localhost:${(server.address() as any).port}`;
  const client = providerFetcher({
    base_url: origin,
    tls_ca_certificate: f.other,
  });
  const network = {
    lookup: (async () => [{ address: "10.1.1.1", family: 4 }]) as any,
    connect: ((options: any) =>
      connect({ ...options, host: "127.0.0.1" })) as typeof connect,
  };
  try {
    const missing = await inspectCertificate(origin, network);
    assert.equal(missing.hostnameMatches, true);
    assert.equal(missing.canUse, true);
    assert.equal(
      missing.certificatePem,
      undefined,
      "do not offer an unusable leaf as root",
    );
    assert.equal(
      await (await client.fetch(origin, {})).text(),
      "private-issuer",
    );
    await assert.rejects(fetch(origin));
    server.setSecureContext({ key: f.key, cert: f.cert + f.other });
    const chain = await inspectCertificate(origin, network);
    assert.equal(chain.certificatePem, f.other);
    assert.notEqual(chain.trustFingerprint, chain.fingerprint);
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
    f.close();
  }
});

test("gateway CA persists, reads back, rejects old kernels/private keys and clears on receiver change", async () => {
  const f = certificateFixture();
  const codex = new ProviderCodex();
  codex.runtimeCapabilities.providerCustomCa = true;
  let ctx = await createServer({
    directory: join(f.root, "data"),
    cwd: join(f.root, "work"),
    codex,
    password: "synthetic-cert-password",
  });
  try {
    const origin = "http://127.0.0.1:3100";
    const post = (headers: any) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/certificates/inspect",
        headers,
        payload: { address: "https://127.0.0.1" },
      });
    assert.equal((await post({ origin })).statusCode, 401);
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "synthetic-cert-password" },
    });
    const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
    assert.equal(
      (await post({ origin: "https://foreign.invalid", cookie })).statusCode,
      403,
    );
    assert.equal((await post({ origin, cookie })).statusCode, 400);
    const cfg = () => ctx.service.configuration.read();
    const start = await cfg();
    const saved: any = await ctx.service.handle("gateway/save", {
      requestId: crypto.randomUUID(),
      name: "TLS gateway",
      baseUrl: "https://localhost:9443/v1",
      caCertificate: f.cert,
      expectedRevision: start.publicView.revision,
    });
    const id = saved.id;
    assert.equal(
      saved.configuration.providers.find((p: any) => p.id === id).caCertificate,
      f.cert,
    );
    const row = ctx.db.raw
      .prepare("SELECT content FROM provider_configuration")
      .get() as any;
    assert.equal(
      JSON.parse(row.content).model_providers[id].tls_ca_certificate,
      f.cert,
    );
    await ctx.app.close();
    ctx = await createServer({
      directory: join(f.root, "data"),
      cwd: join(f.root, "work"),
      codex,
      password: "synthetic-cert-password",
    });
    assert.equal(
      (await cfg()).publicView.providers.find((p) => p.id === id)
        ?.caCertificate,
      f.cert,
      "provider trust survives full server reopen",
    );
    const rev = () =>
      cfg().then((s) => s.publicView.revisions![`provider:${id}`]);
    codex.runtimeCapabilities.providerCustomCa = false;
    await assert.rejects(
      ctx.service.handle("provider/save", {
        id,
        create: false,
        expectedRevision: await rev(),
        patch: { caCertificate: f.cert },
      }),
      /内核/,
    );
    codex.runtimeCapabilities.providerCustomCa = true;
    await assert.rejects(
      ctx.service.handle("provider/save", {
        id,
        create: false,
        expectedRevision: await rev(),
        patch: { caCertificate: f.key },
      }),
      /私钥/,
    );
    await ctx.service.handle("provider/save", {
      id,
      create: false,
      expectedRevision: await rev(),
      patch: { baseUrl: "https://other.example/v1" },
    });
    assert.equal(
      (await cfg()).publicView.providers.find((p) => p.id === id)
        ?.caCertificate,
      undefined,
    );
  } finally {
    await ctx.app.close();
    f.close();
  }
});

test("plugin certificate address resolves only ordinary declared URL fields and invalidates unresolved targets", () => {
  const c: any = {
    endpointTemplate: "${user_config.endpoint}/mcp",
    fields: [{ id: "endpoint", type: "string", sensitive: false }],
  };
  assert.equal(
    pluginCertificateAddress(c, { endpoint: "https://private.example" }),
    "https://private.example/mcp",
  );
  assert.equal(pluginCertificateAddress(c, {}), "");
  assert.equal(
    pluginCertificateAddress(
      { ...c, fields: [{ id: "endpoint", type: "string", sensitive: true }] },
      { endpoint: "https://private.example" },
    ),
    "",
  );
  assert.equal(
    pluginCertificateAddress(
      {
        endpointTemplate: "https://user:password@example.com",
        fields: [],
      } as any,
      {},
    ),
    "",
  );
});

test("HTTP plugin trust is host-owned, address-bound, restored after reopen and removable without schema fields", async () => {
  const f = certificateFixture();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { database } = await import("../server/db.js");
  const { pluginConnections } = await import("../server/plugin-connections.js");
  const { importTree } = await import("../server/import-files.js");
  const folder = join(f.root, "plugin");
  mkdirSync(folder);
  writeFileSync(
    join(folder, "plugin.json"),
    JSON.stringify({ name: "tls-plugin", version: "1.0.0" }),
  );
  writeFileSync(
    join(folder, "mcp.json"),
    JSON.stringify({
      mcpServers: { remote: { url: "https://localhost:9443/mcp" } },
    }),
  );
  const tree = await importTree(folder);
  const directory = join(f.root, "data");
  let db = database(directory);
  let connections = pluginConnections(db, undefined, undefined, () => true);
  const pluginId = "tls-plugin@newbot-imports";
  db.raw
    .prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)")
    .run(
      crypto.randomUUID(),
      "plugin",
      "tls-plugin",
      folder,
      tree.digest,
      JSON.stringify({ installed: true, mcp: ["remote"] }),
    );
  const raw = () =>
    ({
      config: { mcp_servers: {}, plugins: {} },
      origins: {},
      layers: [],
    }) as any;
  const save = async (extra: any) => {
    const c = (await connections.list(pluginId))[0];
    const input = {
      operation: "plugin.configuration.save" as const,
      requestId: crypto.randomUUID(),
      pluginId,
      connectionId: c.id,
      expectedRevision: c.revision,
      schemaDigest: c.schemaDigest,
      values: {},
      enabled: true,
      clearSecrets: [],
      ...extra,
    };
    const consumer = await connections.prepare(input);
    await consumer.run(
      Buffer.from(Buffer.from("{}").toString("base64")),
      new AbortController().signal,
      () => true,
      () => {},
    );
    return c.id;
  };
  try {
    const c = (await connections.list(pluginId))[0];
    assert.equal(c.fields.length, 0);
    assert.equal(c.endpointTemplate, "https://localhost:9443/mcp");
    await assert.rejects(
      save({
        caCertificate: f.cert,
        certificateAddress: "https://other.example",
      }),
      /不匹配/,
    );
    const id = await save({
      caCertificate: f.cert,
      certificateAddress: c.endpointTemplate,
    });
    assert.equal(
      ((await connections.overlay(raw())).config as any).mcp_servers[id]
        .tls_ca_certificate,
      f.cert,
    );
    db.raw.close();
    db = database(directory);
    connections = pluginConnections(db, undefined, undefined, () => true);
    assert.equal((await connections.list(pluginId))[0].caCertificate, f.cert);
    await save({});
    assert.equal(
      ((await connections.overlay(raw())).config as any).mcp_servers[id]
        .tls_ca_certificate,
      f.cert,
      "older clients preserve matching trust",
    );
    await save({ caCertificate: null });
    assert.equal(
      ((await connections.overlay(raw())).config as any).mcp_servers[id]
        .tls_ca_certificate,
      undefined,
    );
  } finally {
    db.raw.close();
    f.close();
  }
});
