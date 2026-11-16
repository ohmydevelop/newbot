import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { database } from "../server/db.js";
import { credentialVault } from "../server/credential-vault.js";
import { automationMail } from "../server/automation-mail.js";
import { automations } from "../server/automations.js";
import { automationSchema } from "../shared/automations.js";
for (const secure of [false, true])
  test(`SMTP ${secure ? "TLS" : "STARTTLS"}: encrypted persistence, certificate, auth, delivery and independent retry`, async () => {
    const root = mkdtempSync(join(tmpdir(), "newbot-smtp-")),
      directory = join(root, "data"),
      cwd = join(root, "work");
    mkdirSync(directory);
    mkdirSync(cwd);
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
        join(root, "key"),
        "-out",
        join(root, "cert"),
      ],
      { stdio: "ignore" },
    );
    const ca = readFileSync(join(root, "cert"), "utf8"),
      messages: string[] = [];
    let refuse = false;
    let holdMessage: (() => Promise<void>) | undefined;
    const smtp = new SMTPServer({
      secure,
      key: readFileSync(join(root, "key")),
      cert: ca,
      logger: false,
      onAuth(auth, _session, cb) {
        cb(
          auth.username === "test" && auth.password === "test-smtp-private"
            ? null
            : new Error("invalid login"),
          { user: "test" },
        );
      },
      onData(stream, _session, cb) {
        let text = "";
        stream.on("data", (chunk) => (text += chunk.toString()));
        stream.on("end", async () => {
          await holdMessage?.();
          if (refuse) {
            const e = Object.assign(new Error("rejected"), {
              responseCode: 550,
            });
            cb(e);
            return;
          }
          messages.push(text);
          cb();
        });
      },
    });
    smtp.on("error", () => {});
    await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
    const port = (smtp.server.address() as any).port;
    const db = database(directory),
      vault = credentialVault(db, directory, cwd);
    let mail = automationMail(db, vault),
      calls = 0;
    const a = automations(db, {
      ready: () => true,
      validate: async () => {},
      submit: async () => {
        calls++;
        return {
          statusCode: 200,
          body: { threadId: randomUUID(), turn: { id: randomUUID() } },
        };
      },
      probe: async () => ({ state: "succeeded" }),
      cancel: async () => {},
    });
    try {
      const config = {
        host: "127.0.0.1",
        port,
        secure,
        user: "test",
        from: "bot@example.test",
        to: "owner@example.test",
        baseUrl: "https://newbot.example.test",
        ca,
      };
      let saved = mail.save({
        revision: 0,
        config,
        password: "test-smtp-private",
      });
      assert.equal(saved.hasPassword, true);
      assert.ok(!JSON.stringify(saved).includes("test-smtp-private"));
      assert.ok(
        !JSON.stringify(
          db.raw.prepare("SELECT * FROM automation_mail_config").get(),
        ).includes("test-smtp-private"),
      );
      assert.throws(
        () => mail.save({ revision: 0, config, password: "x" }),
        /已变化/,
      );
      assert.throws(
        () =>
          mail.save({
            revision: 1,
            config: { ...config, host: "elsewhere.example" },
          }),
        /重新输入/,
      );
      await mail.test({ revision: 1, send: false });
      assert.equal(messages.length, 0);
      await mail.test({ revision: 1, send: true });
      assert.equal(messages.length, 1);
      saved = mail.save({
        revision: 1,
        config: { ...config, ca: "" },
        password: "test-smtp-private",
      });
      await assert.rejects(
        mail.test({ revision: saved.revision, send: false }),
        /证书/,
      );
      saved = mail.save({
        revision: saved.revision,
        config,
        password: "wrong",
      });
      await assert.rejects(
        mail.test({ revision: saved.revision, send: false }),
        /身份验证/,
      );
      saved = mail.save({
        revision: saved.revision,
        config,
        password: "test-smtp-private",
      });
      const task = await a.save({
        id: randomUUID(),
        expectedRevision: 0,
        content: automationSchema.parse({
          name: "邮件任务",
          prompt: "只回答完成",
          notification: "both",
          triggers: [
            {
              id: randomUUID(),
              frequency: "daily",
              date: "2026-01-01",
              time: "08:00",
              timezone: "UTC",
            },
          ],
        }),
      });
      const run = a.runNow(task.id, task.revision, randomUUID());
      await a.tick();
      await a.tick();
      assert.equal(a.result(run.id).state, "succeeded");
      refuse = true;
      await mail.tick();
      assert.equal(mail.status(run.id)?.state, "failed");
      assert.equal(calls, 1);
      refuse = false;
      mail.retry(run.id);
      await Promise.all([mail.tick(), mail.tick()]);
      assert.equal(mail.status(run.id)?.state, "sent");
      assert.equal(calls, 1);
      assert.equal(messages.length, 2);
      assert.ok(
        messages[1].replace(/=\r?\n/g, "").includes("automation=3D" + run.id),
      );
      await mail.tick();
      assert.equal(messages.length, 2);
      assert.throws(() => mail.retry(run.id), /无需重试/);
      const batch = [];
      for (let i = 0; i < 2; i++) {
        const next = a.runNow(task.id, task.revision, randomUUID());
        await a.tick();
        await a.tick();
        assert.equal(a.result(next.id).state, "succeeded");
        batch.push(next);
      }
      let entered!: () => void;
      let release!: () => void;
      const sending = new Promise<void>((r) => (entered = r));
      const resume = new Promise<void>((r) => (release = r));
      holdMessage = async () => {
        entered();
        await resume;
      };
      const delivery = mail.tick();
      try {
        await Promise.race([
          sending,
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error("SMTP DATA was not reached")),
              5000,
            ).unref();
          }),
        ]);
        saved = mail.save({
          revision: saved.revision,
          config: { ...config, to: "new-owner@example.test" },
        });
      } finally {
        holdMessage = undefined;
        release();
        await delivery;
      }
      const states = batch.map((v) => mail.status(v.id)?.state).sort();
      assert.deepEqual(states, ["failed", "sent"]);
      assert.equal(messages.length, 3);
      assert.match(messages[2], /To: owner@example.test/);
      const withheld = batch.find(
        (v) => mail.status(v.id)?.state === "failed",
      )!;
      assert.match(mail.status(withheld.id)?.error || "", /配置已变化/);
      const submitted = calls;
      await mail.tick();
      assert.equal(messages.length, 3);
      mail.retry(withheld.id);
      await Promise.all([mail.tick(), mail.tick()]);
      assert.equal(mail.status(withheld.id)?.state, "sent");
      assert.equal(calls, submitted);
      assert.equal(messages.length, 4);
      assert.match(messages[3], /To: new-owner@example.test/);
      db.raw
        .prepare(
          "UPDATE automation_deliveries SET state='sending' WHERE run_id=?",
        )
        .run(run.id);
      mail = automationMail(db, vault);
      assert.equal(mail.status(run.id)?.state, "unknown");
      await mail.tick();
      assert.equal(messages.length, 4);
      vault.close();
      const restartedVault = credentialVault(db, directory, cwd),
        restarted = automationMail(db, restartedVault);
      await restarted.test({ revision: saved.revision, send: false });
      restartedVault.close();
      unlinkSync(join(directory, "private-credentials.key"));
      const locked = credentialVault(db, directory, cwd);
      assert.equal(locked.encryptionAvailable, false);
      assert.equal(
        existsSync(join(directory, "private-credentials.key")),
        false,
      );
      locked.close();
    } finally {
      await a.close();
      await mail.close();
      vault.close();
      db.raw.close();
      await new Promise<void>((r) => smtp.close(r));
      rmSync(root, { recursive: true, force: true });
    }
  });
