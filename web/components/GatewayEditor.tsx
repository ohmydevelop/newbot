import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Modal } from "./ui";
import { request, useApp, loadSettings, acceptSettings } from "../store";
import type { ConfigurationView } from "../../shared/configuration";
import {
  credentialPending,
  credentialStatus,
  type CredentialTicket,
} from "../../shared/credentials";
type Provider = ConfigurationView["providers"][number];
async function privateApi(path: string, options?: RequestInit): Promise<any> {
  const r = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (r.status === 401) useApp.setState({ authenticated: false });
  if (!r.ok) throw new Error("操作未完成，请读取状态确认结果。");
  return r.json();
}
export default function GatewayEditor({
  provider,
  revision: initialRevision,
  onClose,
  onSaved,
  children,
  onProbe,
}: {
  provider?: Provider;
  revision: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  children?: React.ReactNode;
  onProbe?: () => void;
}) {
  const s = useApp(),
    key = useRef<HTMLInputElement>(null),
    posting = useRef(false),
    mounted = useRef(true);
  const [name, setName] = useState(
      provider?.missing ? "" : provider?.name || "",
    ),
    [url, setUrl] = useState(""),
    [revision, setRevision] = useState(initialRevision),
    [vaultVersion, setVaultVersion] = useState(
      provider?.managedCredential?.version,
    ),
    [retention, setRetention] = useState<"encrypted" | "memory">(
      s.credentialEncryption ? "encrypted" : "memory",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmClear, setConfirmClear] = useState(false),
    [ticket, setTicket] = useState<CredentialTicket | null>(null);
  const privateId = useRef<string | null>(null),
    requestId = useRef(crypto.randomUUID());
  const readOnly = !!provider && !provider.editable;
  const active =
    busy ||
    (!!ticket && credentialPending(ticket.state) && ticket.state !== "waiting");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (key.current) key.current.value = "";
      if (privateId.current)
        void fetch(`/api/credentials/${privateId.current}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
    };
  }, []);
  async function receive(value: CredentialTicket) {
    if (!mounted.current) return;
    setTicket(value);
    if (value.state === "succeeded") {
      await onSaved();
      if (value.applied) onClose();
    }
  }
  async function readStatus() {
    if (!privateId.current) return;
    setBusy(true);
    setError("");
    try {
      await receive(await privateApi(`/api/credentials/${privateId.current}`));
    } catch {
      setError("结果暂不可读，请恢复连接后重试；不会重复发送密钥。");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (posting.current || readOnly) return;
    const bytes = new TextEncoder().encode(key.current?.value || "");
    if (key.current) key.current.value = "";
    posting.current = true;
    setBusy(true);
    setError("");
    try {
      const metadata = {
        requestId: requestId.current,
        targetId: provider?.id,
        expectedRevision: revision,
        name,
        ...(url ? { baseUrl: url } : {}),
      };
      if (bytes.length || privateId.current) {
        if (!bytes.length) throw new Error("请重新填写 API Key。");
        if (url && new URL(url).protocol !== "https:")
          throw new Error("填写 API Key 时请使用 HTTPS 连接地址。");
        if (!privateId.current) {
          privateId.current = requestId.current;
          const created = await privateApi("/api/credentials/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...metadata,
              operation: "provider.save",
              expectedVaultVersion: vaultVersion,
              retention,
            }),
          });
          setTicket(created);
          if (created.state !== "waiting")
            throw new Error("保存条件已变化，请关闭后重新读取配置。");
        }
        await receive(
          await privateApi(`/api/credentials/${privateId.current}/input`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: bytes,
          }),
        );
      } else {
        await request("gateway/save", metadata);
        await onSaved();
        onClose();
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "保存未确认，请刷新配置。");
    } finally {
      bytes.fill(0);
      posting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    setError("");
    try {
      const result = await privateApi("/api/credentials/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "provider",
          targetId: provider!.id,
          expectedRevision: revision,
          expectedVaultVersion: vaultVersion,
          confirm: true,
        }),
      });
      await loadSettings();
      const config = useApp.getState().settings
        ?.configuration as ConfigurationView;
      setRevision(config.revision);
      setVaultVersion(
        config.providers.find((p) => p.id === provider!.id)?.managedCredential
          ?.version,
      );
      setConfirmClear(false);
      if (!result.applied) setError("密钥已清除，连接尚未恢复，请刷新后确认。");
    } catch {
      setError("清除结果未确认，请刷新配置确认后再操作。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={provider ? provider.name : "添加模型网关"}
      wide
      className="connection-editor-modal gateway-editor-modal"
      dismissible={!active}
      onOpenChange={(open) => {
        if (!open && !active) onClose();
      }}
    >
      <form
        className="provider-editor"
        aria-label={provider ? "编辑模型网关 表单" : "新增模型网关 表单"}
        onSubmit={(e) => void save(e)}
      >
        <label className="field-label">
          名称
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            disabled={busy || readOnly || !!privateId.current}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {provider && !provider.missing && (
          <div className="current-endpoint">
            <span>当前连接地址</span>
            <code>
              {provider.endpointOrigin ||
                (provider.requiresAccountAuth ? "账户授权" : "未配置")}
            </code>
            {onProbe && (
              <button
                type="button"
                className="secondary"
                disabled={active || !!url || !!privateId.current}
                title={
                  url
                    ? "先保存新的连接地址，再验证凭证"
                    : "仅验证当前已保存连接，不保存凭证"
                }
                aria-label={`临时验证 ${provider.id} 的凭证`}
                onClick={onProbe}
              >
                临时验证当前凭证
              </button>
            )}
          </div>
        )}
        {!readOnly && (
          <label className="field-label">
            {provider && !provider.missing ? "替换连接地址" : "连接地址"}
            <input
              type="url"
              required={!provider || provider.missing}
              value={url}
              disabled={busy || !!privateId.current}
              placeholder={
                provider && !provider.missing
                  ? "留空保留当前完整地址"
                  : "https://api.example.com/v1"
              }
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
        )}
        {!readOnly && (
          <>
            <label className="field-label">
              API Key
              <input
                ref={key}
                aria-label="API Key"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={4096}
                disabled={
                  busy ||
                  !s.credentialManagement ||
                  (!!ticket && ticket.state !== "waiting")
                }
                placeholder={
                  provider && provider.credentials !== "none"
                    ? "留空保留现有密钥"
                    : "可选"
                }
              />
            </label>
            {s.credentialManagement && (
              <label className="field-label credential-storage-select">
                密钥保存方式
                <select
                  aria-label="密钥保存方式"
                  value={retention}
                  disabled={busy || !!privateId.current}
                  onChange={(e) =>
                    setRetention(e.target.value as typeof retention)
                  }
                >
                  {s.credentialEncryption && (
                    <option value="encrypted">本机加密保存</option>
                  )}
                  <option value="memory">仅本次运行</option>
                </select>
              </label>
            )}
          </>
        )}
        {readOnly && <p className="muted">此网关由账户或其他配置来源管理。</p>}
        {provider?.managedCredential?.stored &&
          !provider.missing &&
          !ticket && (
            <button
              type="button"
              className="secondary danger-text"
              disabled={busy}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 size={14} />
              清除已保存密钥
            </button>
          )}
        {confirmClear && (
          <div role="group" aria-label="确认清除密钥">
            <p>清除后需要重新填写，是否继续？</p>
            <button
              type="button"
              className="secondary"
              onClick={() => setConfirmClear(false)}
            >
              保留
            </button>
            <button
              type="button"
              className="secondary danger-text"
              disabled={busy}
              onClick={() => void clear()}
            >
              清除
            </button>
          </div>
        )}
        {children && (
          <section className="gateway-connection-tools" aria-label="连接管理">
            {children}
          </section>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {ticket && <p role="status">{credentialStatus(ticket)}</p>}
        <div className="configuration-actions editor-actions">
          {privateId.current && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void readStatus()}
            >
              读取状态
            </button>
          )}
          {ticket?.state === "succeeded" && !ticket.applied && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const r = await request<{ settings: any }>(
                      "configuration/recover",
                      { mode: "reconnect" },
                    );
                    acceptSettings(r.settings);
                    await onSaved();
                    onClose();
                  } catch {
                    setError("连接未恢复，请重试。");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              重新连接
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={active}
            onClick={onClose}
          >
            {readOnly ? "关闭" : "取消"}
          </button>
          {!readOnly && (
            <button
              type="submit"
              className="primary"
              disabled={busy || (!!ticket && ticket.state !== "waiting")}
            >
              {busy && <LoaderCircle size={16} className="spin" />}保存
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
