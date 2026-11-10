import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer as httpsServer } from "node:https";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
import { randomUUID } from "node:crypto";
export const credentialTestSecret =
  "credential-fixture-private-value-ONLY-TEST";
export async function credentialFixture(
  origin = "http://127.0.0.1:3126",
  control = false,
  beforeReady?: (ctx: Awaited<ReturnType<typeof createServer>>) => void,
  serverOptions: Pick<
    NonNullable<Parameters<typeof createServer>[0]>,
    "sudoIdentity"
  > = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-private-"));
  const certFile = join(directory, "cert.pem"),
    keyFile = join(directory, "key.pem");
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
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(certFile, "utf8");
  let mode: "ok" | "reject" | "redirect" | "error" | "hang" = "ok";
  const calls: {
    correct: boolean;
    method?: string;
    path?: string;
    cookie: boolean;
    extraHeaders: boolean;
  }[] = [];
  const upstream = httpsServer(
    { key: readFileSync(keyFile), cert },
    (req, res) => {
      calls.push({
        correct: req.headers.authorization === `Bearer ${credentialTestSecret}`,
        method: req.method,
        path: req.url,
        cookie: !!req.headers.cookie,
        extraHeaders: !!req.headers["x-test"],
      });
      if (mode === "hang") return;
      res.statusCode =
        mode === "reject"
          ? 401
          : mode === "redirect"
            ? 302
            : mode === "error"
              ? 500
              : req.headers.authorization === `Bearer ${credentialTestSecret}`
                ? 200
                : 401;
      res.setHeader("location", "https://redirect.invalid/never-send-key");
      res.setHeader("X-Reflected-Key", req.headers.authorization || "");
      res.end(
        JSON.stringify({
          echo: req.headers.authorization,
          detail: "Must never be returned by Bridge",
        }),
      );
    },
  );
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const endpoint = `https://127.0.0.1:${(upstream.address() as any).port}/v1`;
  const codex = new ProviderCodex(endpoint);
  const context = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    codex,
    password: "private-fixture-password",
    origins: [origin],
    credentialCa: cert,
    ...serverOptions,
  });
  if (control)
    context.app.post("/api/test/private", async (req) => {
      const action = (req.body as { action?: string })?.action;
      if (["ok", "reject", "redirect", "error", "hang"].includes(action || ""))
        mode = action as typeof mode;
      if (action === "expire") {
        const now = Date.now;
        try {
          Date.now = () => now() + 120_001;
          void context.credentials.pending;
        } finally {
          Date.now = now;
        }
      }
      if (action === "change") {
        codex.version++;
      }
      return {
        calls,
        pending: context.credentials.pending,
        nativeSecretSeen: JSON.stringify(codex.calls).includes(
          credentialTestSecret,
        ),
        dbSecretSeen: [
          "metadata",
          "audit",
          "runs",
          "a2ui_views",
          "a2ui_drafts",
        ].some((table) =>
          JSON.stringify(
            context.db.raw.prepare(`SELECT * FROM ${table}`).all(),
          ).includes(credentialTestSecret),
        ),
        modelTurns: codex.calls.filter((c) => c.method === "turn/start").length,
      };
    });
  beforeReady?.(context);
  await context.app.ready();
  const login = await context.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "private-fixture-password" },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const config = await context.service.settings();
  const body = () => ({
    requestId: randomUUID(),
    operation: "provider.models.test" as const,
    providerId: "secondary",
    expectedRevision: config.configuration!.revision,
  });
  return {
    ...context,
    directory,
    cert,
    origin,
    headers,
    codex,
    calls,
    endpoint,
    body,
    mode(value: typeof mode) {
      mode = value;
    },
    async request() {
      const response = await context.app.inject({
        method: "POST",
        url: "/api/credentials/requests",
        headers,
        payload: body(),
      });
      if (response.statusCode !== 200)
        throw new Error("Fixture creation failed");
      return response.json();
    },
    input(id: string, value = credentialTestSecret, customHeaders = headers) {
      return context.app.inject({
        method: "POST",
        url: `/api/credentials/${id}/input`,
        headers: {
          ...customHeaders,
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from(value),
      });
    },
    async close() {
      await context.app.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
