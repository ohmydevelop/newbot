import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  createServer,
  connect,
  type TLSSocket,
  type ConnectionOptions,
} from "node:tls";
import { createServer as createTcp, type Socket } from "node:net";
import { X509Certificate } from "node:crypto";
import {
  certificateAddress,
  certificateUrl,
  inspectCertificate,
  certificateInspector,
} from "../server/certificates.js";
import {
  certificateSources,
  certificateSelectionValid,
  clearStaleCertificate,
} from "../web/certificate-draft.js";
import type { PluginConnection } from "../shared/plugin-configuration.js";

test("certificate targets allow explicit private services but reject metadata, loopback, unsafe schemes and credentials", async () => {
  for (const ip of [
    "10.2.97.190",
    "172.16.5.1",
    "192.168.1.1",
    "1.1.1.1",
    "fd12::1",
    "2606:4700::1111",
  ])
    assert.equal(certificateAddress(ip), true, ip);
  for (const ip of [
    "0.0.0.0",
    "127.0.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "224.1.2.3",
    "::1",
    "::ffff:10.0.0.1",
    "fe80::1",
    "fd00:ec2::254",
    "2002:7f00:1::",
  ])
    assert.equal(certificateAddress(ip), false, ip);
  for (const url of [
    "http://server.example",
    "https://user:secret@example.com",
    "https://example.com?key=value",
    "https://example.com#secret",
    "file:///etc/hosts",
    "https://127.1",
    "https://0x7f000001",
    "https://[::1]",
    "https://example.com\\@127.0.0.1",
  ])
    assert.throws(() => certificateUrl(url), Error, url);
  assert.equal(
    certificateUrl("https://10.2.97.190:8443/prefix").origin,
    "https://10.2.97.190:8443",
  );
  let connected = false;
  await assert.rejects(
    inspectCertificate("https://metadata.example", {
      lookup: (async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]) as any,
      connect: (() => {
        connected = true;
        throw Error("must not connect");
      }) as any,
    }),
    /不允许/,
  );
  assert.equal(connected, false);
  await assert.rejects(
    inspectCertificate(
      "https://slow.example",
      {
        lookup: (() => new Promise(() => {})) as any,
        connect: connect,
      },
      20,
    ),
    /超时/,
  );
});

test("TLS observation pins checked DNS, sends no application data, reports trust and invalid certificates, and times out", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbot-cert-observe-"));
  const keyPath = join(root, "key.pem"),
    certPath = join(root, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=service.example",
      "-addext",
      "subjectAltName=DNS:service.example",
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  const key = readFileSync(keyPath),
    cert = readFileSync(certPath);
  let applicationBytes = 0,
    lookups = 0;
  const sockets = new Set<Socket>();
  const server = createServer({ key, cert }, (socket) => {
    socket.on("data", (b) => {
      applicationBytes += b.length;
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("tlsClientError", () => {});
  const slow = createTcp((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  try {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const network = (trusted = false) => ({
      lookup: (async () => {
        lookups++;
        return [{ address: "192.168.2.2", family: 4 }];
      }) as any,
      connect: ((options: ConnectionOptions) => {
        assert.equal(options.host, "192.168.2.2");
        assert.equal(options.servername, "service.example");
        assert.equal(
          options.rejectUnauthorized,
          false,
          "only the observation socket can read untrusted certificate data",
        );
        return connect({
          ...options,
          host: "127.0.0.1",
          ...(trusted ? { ca: cert } : {}),
        });
      }) as typeof connect,
    });
    const result = await inspectCertificate(
      `https://service.example:${port}/path`,
      network(),
    );
    assert.equal(result.systemTrusted, false);
    assert.equal(result.hostnameMatches, true);
    assert.equal(result.canUse, true);
    assert.equal(
      result.fingerprint,
      new X509Certificate(cert).fingerprint256
        .replaceAll(":", "")
        .toLowerCase(),
    );
    assert.equal(lookups, 1);
    const trusted = await inspectCertificate(
      `https://service.example:${port}`,
      network(true),
    );
    assert.equal(trusted.systemTrusted, true);
    const mismatch = await inspectCertificate(`https://other.example:${port}`, {
      lookup: network().lookup,
      connect: ((o: ConnectionOptions) =>
        connect({ ...o, host: "127.0.0.1", ca: cert })) as typeof connect,
    });
    assert.equal(mismatch.hostnameMatches, false);
    assert.equal(mismatch.systemTrusted, false);
    assert.equal(applicationBytes, 0);
    const csr = join(root, "request.pem"),
      expired = join(root, "expired.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-key",
        keyPath,
        "-subj",
        "/CN=service.example",
        "-out",
        csr,
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        csr,
        "-signkey",
        keyPath,
        "-not_before",
        "20200101000000Z",
        "-not_after",
        "20200102000000Z",
        "-out",
        expired,
      ],
      { stdio: "ignore" },
    );
    server.setSecureContext({ key, cert: readFileSync(expired) });
    assert.equal(
      (await inspectCertificate(`https://service.example:${port}`, network()))
        .canUse,
      false,
    );
    execFileSync(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        csr,
        "-signkey",
        keyPath,
        "-not_before",
        "20400101000000Z",
        "-not_after",
        "20400102000000Z",
        "-out",
        expired,
      ],
      { stdio: "ignore" },
    );
    server.setSecureContext({ key, cert: readFileSync(expired) });
    assert.equal(
      (await inspectCertificate(`https://service.example:${port}`, network()))
        .canUse,
      false,
    );
    await assert.rejects(
      inspectCertificate(
        `https://service.example:${(slow.address() as any).port}`,
        network(),
        60,
      ),
      /超时/,
    );
    for (const socket of sockets) socket.destroy();
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all([
      new Promise<void>((r) => server.close(() => r())),
      new Promise<void>((r) => slow.close(() => r())),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("certificate drafts never infer secret destinations or keep a generated pin for a changed address", () => {
  const c = {
    fields: [
      { id: "url", type: "string", sensitive: false },
      { id: "secret", type: "string", sensitive: true },
      { id: "pin", type: "string", sensitive: false },
      { id: "counter", type: "number", sensitive: false },
    ],
  } as PluginConnection;
  const values = {
    url: "https://one.example",
    secret: "https://do-not-probe.example",
  };
  assert.deepEqual(
    certificateSources(c, values).map((f) => f.id),
    ["url"],
  );
  const s = {
    sourceId: "url",
    address: values.url,
    targetId: "pin",
    observation: {
      canUse: true,
      expiresAt: Date.now() + 60000,
      fingerprint: "a".repeat(64),
    },
  } as any;
  assert.equal(certificateSelectionValid(c, values, s), true);
  for (const targetId of ["secret", "url", "counter", "missing"])
    assert.equal(
      certificateSelectionValid(c, values, { ...s, targetId }),
      false,
    );
  assert.equal(
    certificateSelectionValid(c, { ...values, url: "https://two.example" }, s),
    false,
  );
  assert.equal(
    certificateSelectionValid(c, values, {
      ...s,
      observation: { ...s.observation, expiresAt: 1 },
    }),
    false,
  );
  assert.equal(
    certificateSelectionValid(c, values, {
      ...s,
      observation: { ...s.observation, canUse: false },
    }),
    false,
  );
  assert.equal(
    clearStaleCertificate(
      { url: "https://two.example", pin: s.observation.fingerprint },
      s,
    ).pin,
    undefined,
  );
  assert.equal(
    clearStaleCertificate(
      { url: "https://two.example", pin: "manually-replaced" },
      s,
    ).pin,
    "manually-replaced",
  );
});

test("certificate inspection enforces concurrency and per-minute limits including failures", async () => {
  const waiting: (() => void)[] = [];
  const inspect = certificateInspector(async () => {
    await new Promise<void>((r) => waiting.push(r));
    return {} as any;
  });
  const one = inspect("https://one.example"),
    two = inspect("https://two.example");
  await assert.rejects(inspect("https://third.example"), /频繁/);
  waiting.splice(0).forEach((r) => r());
  await Promise.all([one, two]);
  const limited = certificateInspector(async () => {
    throw Error("synthetic TLS failure");
  });
  for (let i = 0; i < 12; i++)
    await assert.rejects(limited("https://one.example"), /synthetic/);
  await assert.rejects(limited("https://one.example"), /频繁/);
});

test("real TLS rejects oversized certificates and never assumes a SAN-less certificate matches an IP", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbot-cert-boundaries-"));
  const keyPath = join(root, "key.pem"),
    certPath = join(root, "cert.pem");
  const sockets = new Set<Socket>();
  let bytes = 0;
  const generate = (extra: string[] = []) =>
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=192.168.2.2",
        ...extra,
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" },
    );
  generate();
  const server = createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    (socket) => {
      socket.on("data", (b) => (bytes += b.length));
    },
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("tlsClientError", () => {});
  try {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `https://192.168.2.2:${(server.address() as any).port}`;
    const network = {
      lookup: (async () => [{ address: "192.168.2.2", family: 4 }]) as any,
      connect: ((options: ConnectionOptions) =>
        connect({ ...options, host: "127.0.0.1" })) as typeof connect,
    };
    assert.equal(
      new X509Certificate(readFileSync(certPath)).subjectAltName,
      undefined,
    );
    const observed = await inspectCertificate(url, network);
    assert.equal(observed.hostnameMatches, false);
    assert.equal(observed.systemTrusted, false);
    // A valid fingerprint is an explicit identity choice, never automatic trust.
    assert.equal(observed.canUse, true);
    generate(["-addext", "1.2.3.4=ASN1:UTF8String:" + "x".repeat(67000)]);
    assert.ok(new X509Certificate(readFileSync(certPath)).raw.length > 65536);
    server.setSecureContext({
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    });
    await assert.rejects(inspectCertificate(url, network), /超过读取限制/);
    assert.equal(bytes, 0);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
});
