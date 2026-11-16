import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Modal } from "./ui";
import { FormActions, FormSubmit } from "./FormActions";
import { automationRequest } from "../automations";
import { AutomationChoice } from "./AutomationChoice";
import type { MailConfig, MailSettings } from "../../shared/automation-mail";
export default function AutomationMailSettings({
  onClose,
}: {
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<MailSettings | null>(null),
    [draft, setDraft] = useState<MailConfig>({
      host: "",
      port: 465,
      secure: true,
      user: "",
      from: "",
      to: "",
      baseUrl: location.origin,
      ca: "",
    }),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef(false),
    certificateFile = useRef<HTMLInputElement>(null);
  const [certificateName, setCertificateName] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void automationRequest<MailSettings>("/mail", undefined, abort.signal)
      .then((v) => {
        if (abort.signal.aborted) return;
        setSettings(v);
        if (v.config) setDraft(v.config);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  const dirty =
    !settings?.config ||
    JSON.stringify(draft) !== JSON.stringify(settings.config) ||
    !!password;
  async function action(fn: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const test = (send: boolean) =>
    action(async () => {
      const r = await automationRequest("/mail/test", {
        revision: settings!.revision,
        send,
      });
      setNotice(r.message);
    });
  return (
    <Modal
      open
      title="邮件通知"
      className="automation-editor"
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      dismissible={!busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const s = await automationRequest<MailSettings>("/mail/save", {
              revision: settings!.revision,
              config: draft,
              ...(password || !draft.user ? { password } : {}),
            });
            setSettings(s);
            setPassword("");
            setNotice("已保存，可检查连接或发送测试邮件。");
          });
        }}
      >
        <div className="automation-editor-body automation-mail-fields">
          <label>
            SMTP 服务器
            <input
              required
              autoComplete="off"
              value={draft.host}
              onChange={(e) =>
                setDraft((d) => ({ ...d, host: e.target.value }))
              }
              disabled={busy}
            />
          </label>
          <div className="automation-mail-row">
            <label>
              端口
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={draft.port}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, port: Number(e.target.value) }))
                }
                disabled={busy}
              />
            </label>
            <AutomationChoice
              label="连接加密"
              value={draft.secure ? "tls" : "starttls"}
              options={[
                { id: "tls", label: "TLS" },
                { id: "starttls", label: "STARTTLS" },
              ]}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  secure: v === "tls",
                  port: v === "tls" ? 465 : 587,
                }))
              }
              disabled={busy}
            />
          </div>
          <label>
            账号
            <input
              autoComplete="off"
              value={draft.user}
              onChange={(e) =>
                setDraft((d) => ({ ...d, user: e.target.value }))
              }
              disabled={busy}
            />
          </label>
          <label>
            应用密码
            <input
              type="password"
              autoComplete="new-password"
              placeholder={settings?.hasPassword ? "已保存，输入新值替换" : ""}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            发件邮箱
            <input
              type="email"
              required
              value={draft.from}
              onChange={(e) =>
                setDraft((d) => ({ ...d, from: e.target.value }))
              }
              disabled={busy}
            />
          </label>
          <label>
            收件邮箱
            <input
              type="email"
              required
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              disabled={busy}
            />
          </label>
          <label>
            newbot 地址
            <input
              type="url"
              required
              value={draft.baseUrl}
              onChange={(e) =>
                setDraft((d) => ({ ...d, baseUrl: e.target.value }))
              }
              disabled={busy}
            />
          </label>
          <label>
            私有 CA 证书（可选）
            <textarea
              aria-label="邮件 CA 证书"
              placeholder="PEM"
              rows={2}
              value={draft.ca}
              onChange={(e) => setDraft((d) => ({ ...d, ca: e.target.value }))}
              disabled={busy}
            />
            <span className="automation-certificate-select">
              <button
                type="button"
                className="secondary"
                aria-label="选择邮件证书"
                disabled={busy}
                onClick={() => certificateFile.current?.click()}
              >
                <Upload size={17} />
                选择证书
              </button>
              <small className="muted">
                {certificateName || (draft.ca ? "已载入证书" : "未选择")}
              </small>
            </span>
            <input
              hidden
              ref={certificateFile}
              type="file"
              accept=".pem,.crt,.cer"
              aria-label="选择邮件证书"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 64000) {
                  setError("证书文件过大");
                  return;
                }
                void action(async () => {
                  const ca = await f.text();
                  setDraft((d) => ({ ...d, ca }));
                  setCertificateName(f.name);
                });
              }}
            />
          </label>
          <small className="muted">
            邮件包含任务状态和结果入口，发送到此收件邮箱。
          </small>
        </div>
        <div className="automation-editor-footer">
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <FormActions>
            <button
              type="button"
              disabled={busy || dirty}
              onClick={() => void test(false)}
            >
              检查连接
            </button>
            <button
              type="button"
              disabled={busy || dirty}
              onClick={() => void test(true)}
            >
              发送测试邮件
            </button>
            <FormSubmit
              busy={busy}
              disabled={!settings || !dirty}
              busyLabel="处理中…"
            >
              保存
            </FormSubmit>
          </FormActions>
        </div>
      </form>
    </Modal>
  );
}
