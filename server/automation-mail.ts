import nodemailer from "nodemailer";
import { randomUUID, X509Certificate } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.js";
import type { credentialVault } from "./credential-vault.js";
import {
  mailConfigSchema,
  type MailConfig,
  type MailSettings,
} from "../shared/automation-mail.js";
import { runStateLabels } from "../shared/automations.js";
import { PublicError } from "./public-error.js";
type ConfigRow = { revision: number; content: string; packet: string };
export function automationMail(
  db: Store,
  vault: Pick<
    ReturnType<typeof credentialVault>,
    "openPrivate" | "sealPrivate"
  >,
) {
  const context = "newbot:automation-mail:v1";
  const configRow = () =>
    db.raw.prepare("SELECT * FROM automation_mail_config WHERE id=1").get() as
      | ConfigRow
      | undefined;
  function secret(row: ConfigRow) {
    const bytes = vault.openPrivate(row.packet, context + ":" + row.revision);
    try {
      return bytes.toString();
    } finally {
      bytes.fill(0);
    }
  }
  const settings = (): MailSettings => {
    const row = configRow();
    return {
      revision: row?.revision || 0,
      config: row ? JSON.parse(row.content) : null,
      hasPassword: !!row && !!JSON.parse(row.content).user,
    };
  };
  function save(body: unknown) {
    const p = z
      .object({
        revision: z.number().int().nonnegative(),
        config: mailConfigSchema,
        password: z.string().max(4096).optional(),
      })
      .parse(body);
    const before = configRow();
    if ((before?.revision || 0) !== p.revision)
      throw new PublicError("邮件配置已变化，请刷新后重试");
    if (p.config.ca) {
      try {
        const certs = p.config.ca.match(
          /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
        );
        if (!certs?.length) throw Error();
        for (const pem of certs) new X509Certificate(pem);
      } catch {
        throw new PublicError("请选择有效的 PEM 证书");
      }
    }
    const prior: MailConfig | undefined = before
      ? JSON.parse(before.content)
      : undefined;
    if (
      p.password === undefined &&
      prior &&
      (prior.host !== p.config.host ||
        prior.port !== p.config.port ||
        prior.secure !== p.config.secure ||
        prior.user !== p.config.user ||
        prior.ca !== p.config.ca)
    )
      throw new PublicError("服务器或账号已变化，请重新输入邮件密码");
    const password = p.password ?? (before ? secret(before) : "");
    if (p.config.user && !password)
      throw new PublicError("请输入邮件密码或应用密码");
    const bytes = Buffer.from(password),
      revision = p.revision + 1;
    let packet: string;
    try {
      packet = vault.sealPrivate(bytes, context + ":" + revision);
    } finally {
      bytes.fill(0);
    }
    db.raw
      .prepare(
        "INSERT INTO automation_mail_config VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,content=excluded.content,packet=excluded.packet",
      )
      .run(revision, JSON.stringify(p.config), packet);
    db.audit("automation/mail/save", "smtp", "saved");
    return settings();
  }
  function transport(row: ConfigRow) {
    const c: MailConfig = JSON.parse(row.content);
    return nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      requireTLS: !c.secure,
      auth: c.user ? { user: c.user, pass: secret(row) } : undefined,
      tls: { rejectUnauthorized: true, ...(c.ca ? { ca: c.ca } : {}) },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  }
  const requireConfig = () => {
    const row = configRow();
    if (!row) throw new PublicError("请先配置邮件通知");
    return row;
  };
  function message(row: ConfigRow, subject: string, text: string, id: string) {
    const c: MailConfig = JSON.parse(row.content);
    return {
      from: c.from,
      to: c.to,
      subject,
      text,
      messageId: `<${id}@newbot.local>`,
      disableFileAccess: true,
      disableUrlAccess: true,
    };
  }
  async function test(body: unknown) {
    const p = z
        .object({
          revision: z.number().int(),
          send: z.boolean().default(false),
        })
        .parse(body),
      row = requireConfig();
    if (row.revision !== p.revision)
      throw new PublicError("邮件配置已变化，请重新加载");
    const t = transport(row);
    try {
      if (p.send)
        await t.sendMail(
          message(
            row,
            "newbot 邮件通知测试",
            "这是一封 newbot 邮件通知测试。",
            randomUUID(),
          ),
        );
      else await t.verify();
      return {
        ok: true,
        message: p.send
          ? "测试邮件已交付服务器，请检查收件箱"
          : "连接与身份验证成功",
      };
    } catch (e) {
      throw new PublicError(mailError(e).message);
    } finally {
      t.close();
    }
  }
  db.raw
    .prepare(
      "UPDATE automation_deliveries SET state='unknown',error='发送被服务重启中断，请核对收件箱后再重试' WHERE state='sending'",
    )
    .run();
  let active: Promise<void> | undefined;
  async function deliver() {
    const row = configRow();
    const completed = db.raw
      .prepare(
        "SELECT r.* FROM automation_runs r LEFT JOIN automation_deliveries d ON d.run_id=r.id WHERE r.completed IS NOT NULL AND r.state!='cancelled' AND d.run_id IS NULL AND json_extract(r.snapshot,'$.notification') IN ('email','both') LIMIT 20",
      )
      .all() as any[];
    for (const r of completed) {
      const c: MailConfig | undefined = row
        ? JSON.parse(row.content)
        : undefined;
      db.raw
        .prepare(
          "INSERT OR IGNORE INTO automation_deliveries(run_id,config_revision,recipient,state,error) VALUES(?,?,?,?,?)",
        )
        .run(
          r.id,
          row?.revision || 0,
          c?.to || "",
          row ? "queued" : "failed",
          row ? null : "邮件未配置",
        );
    }
    const pending = db.raw
      .prepare(
        "SELECT d.*,r.snapshot,r.state AS run_state,r.thread_id,r.scheduled_at FROM automation_deliveries d JOIN automation_runs r ON r.id=d.run_id WHERE d.state='queued' LIMIT 10",
      )
      .all() as any[];
    for (const d of pending) {
      if (!row || row.revision !== d.config_revision) {
        db.raw
          .prepare(
            "UPDATE automation_deliveries SET state='failed',error='邮件配置已变化，请确认收件人后重试' WHERE run_id=?",
          )
          .run(d.run_id);
        continue;
      }
      db.raw
        .prepare(
          "UPDATE automation_deliveries SET state='sending',attempt=attempt+1,error=NULL WHERE run_id=?",
        )
        .run(d.run_id);
      const c: MailConfig = JSON.parse(row.content),
        task = JSON.parse(d.snapshot);
      const link = new URL(c.baseUrl);
      link.searchParams.set("automation", d.run_id);
      let t: ReturnType<typeof transport> | undefined;
      try {
        t = transport(row);
        await t.sendMail(
          message(
            row,
            `newbot · ${task.name} · ${runStateLabels[d.run_state] || d.run_state}`,
            `${task.name}\n${runStateLabels[d.run_state] || d.run_state}\n执行时间：${new Date(d.scheduled_at).toISOString()}\n\n打开自动任务查看结果：${link.toString()}`,
            d.run_id,
          ),
        );
        db.raw
          .prepare(
            "UPDATE automation_deliveries SET state='sent',sent=?,error=NULL WHERE run_id=?",
          )
          .run(Date.now(), d.run_id);
      } catch (e) {
        const failure = mailError(e);
        db.raw
          .prepare(
            "UPDATE automation_deliveries SET state=?,error=? WHERE run_id=?",
          )
          .run(
            failure.unknown ? "unknown" : "failed",
            failure.message,
            d.run_id,
          );
      } finally {
        t?.close();
      }
    }
  }
  return {
    settings,
    save,
    test,
    configured: () => !!configRow(),
    status: (id: string) =>
      db.raw
        .prepare(
          "SELECT state,error,sent FROM automation_deliveries WHERE run_id=?",
        )
        .get(id) as
        | { state: string; error: string | null; sent: number | null }
        | undefined,
    retry(id: string) {
      const row = requireConfig(),
        d = db.raw
          .prepare("SELECT state FROM automation_deliveries WHERE run_id=?")
          .get(id) as any;
      if (!d || !["failed", "unknown"].includes(d.state))
        throw new PublicError("此邮件无需重试");
      db.raw
        .prepare(
          "UPDATE automation_deliveries SET state='queued',config_revision=?,recipient=?,error=NULL WHERE run_id=?",
        )
        .run(row.revision, JSON.parse(row.content).to, id);
      db.audit("automation/mail/retry", id, "queued");
    },
    tick() {
      if (!active) active = deliver().finally(() => (active = undefined));
      return active;
    },
    async close() {
      await active;
    },
  };
}
function mailError(e: unknown) {
  const v = e as { code?: string; command?: string; responseCode?: number };
  if (v.code === "EAUTH")
    return {
      unknown: false,
      message: "邮件身份验证失败，请检查账号和应用密码",
    };
  if (["ETLS", "ESOCKET"].includes(v.code || "") && v.command === "CONN")
    return { unknown: false, message: "邮件服务器连接或证书验证失败" };
  if (v.responseCode)
    return {
      unknown: false,
      message: `邮件服务器拒绝请求（${v.responseCode}），请检查配置和收件人`,
    };
  const unknown =
    !["EDNS", "ECONNECTION", "ETLS", "ENOAUTH"].includes(v.code || "") &&
    ![
      "CONN",
      "AUTH",
      "EHLO",
      "HELO",
      "STARTTLS",
      "MAIL FROM",
      "RCPT TO",
    ].includes(v.command || "");
  return {
    unknown,
    message: unknown
      ? "邮件投递结果未确认，请检查收件箱后再重试"
      : "邮件服务器连接失败，请检查地址、网络和证书",
  };
}
