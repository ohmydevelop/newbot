import { useEffect, useRef, useState } from "react";
import { Modal } from "./ui";
import { useApp, loadSettings, request, acceptSettings } from "../store";
import {
  credentialPending,
  credentialStatus,
  type CredentialTicket,
} from "../../shared/credentials.js";

async function api(
  path: string,
  options?: RequestInit,
): Promise<CredentialTicket> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) useApp.setState({ authenticated: false });
  if (!response.ok) throw new Error("私密请求未完成，请读取状态后重新发起。");
  return response.json();
}
export default function CredentialProbe({
  providerId,
  revision,
  onClose,
  save,
  onCloseAutoFocus,
  sudoPolicy,
}: {
  providerId: string;
  revision: string;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  sudoPolicy?: string;
  save?: {
    scope: "provider" | "mcp";
    targetId: string;
    retention: "memory" | "encrypted";
    expectedVaultVersion: string;
  };
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [ticket, setTicket] = useState<CredentialTicket | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const posting = useRef(false);
  const input = useRef<HTMLInputElement>(null),
    mounted = useRef(false);
  const creation = useRef<Promise<CredentialTicket> | null>(null);
  const path = `/api/credentials/${id}`;
  useEffect(() => {
    mounted.current = true;
    creation.current ||= api("/api/credentials/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        sudoPolicy
          ? {
              requestId: id,
              operation: "sudo.identity",
              expectedPolicy: sudoPolicy,
            }
          : save
            ? {
                ...save,
                requestId: id,
                operation: "credential.save",
                expectedRevision: revision,
              }
            : {
                requestId: id,
                operation: "provider.models.test",
                providerId,
                expectedRevision: revision,
              },
      ),
    });
    void creation.current
      .then((value) => {
        if (mounted.current) setTicket(value);
      })
      .catch(() => {
        if (mounted.current)
          setError("无法创建私密请求，请重新读取当前能力后发起。");
      });
    const hide = () => {
      if (input.current) input.current.value = "";
      void fetch(path, { method: "DELETE", keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      mounted.current = false;
      if (input.current) input.current.value = "";
      void creation.current
        ?.then(() => {
          if (!mounted.current)
            void fetch(path, { method: "DELETE", keepalive: true }).catch(
              () => {},
            );
        })
        .catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!ticket || !credentialPending(ticket.state)) return;
    const timer = setInterval(() => {
      void api(path)
        .then((value) => {
          if (mounted.current && !posting.current)
            setTicket((current) =>
              current && !credentialPending(current.state) ? current : value,
            );
        })
        .catch(() => {
          if (mounted.current)
            setError("状态暂不可读，请恢复连接后读取；不会自动重发凭证。");
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [ticket?.state]);
  useEffect(() => {
    if (ticket?.state !== "waiting" && input.current) input.current.value = "";
    else if (ticket?.state === "waiting") input.current?.focus();
  }, [ticket?.state]);
  async function read() {
    try {
      setTicket(await api(path));
      setError("");
    } catch {
      setError("状态暂不可读，请恢复连接后读取；不会自动重发凭证。");
    }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (
      !input.current ||
      !ticket ||
      ticket.state !== "waiting" ||
      posting.current
    )
      return;
    posting.current = true;
    setSending(true);
    const bytes = new TextEncoder().encode(input.current.value);
    input.current.value = "";
    setTicket({ ...ticket, state: "checking" });
    setError("");
    try {
      const value = await api(path + "/input", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      if (mounted.current) setTicket(value);
      if (save) await loadSettings().catch(() => {});
    } catch {
      if (mounted.current) {
        setError("发送结果未确认，请读取状态；不会自动重发凭证。");
      }
    } finally {
      bytes.fill(0);
      posting.current = false;
      if (mounted.current) setSending(false);
    }
  }
  async function reconnectSaved() {
    setSending(true);
    try {
      const result = await request<{ settings: any }>("configuration/recover", {
        mode: "reconnect",
      });
      acceptSettings(result.settings);
      const rows =
        save?.scope === "mcp"
          ? result.settings.configuration?.mcp
          : result.settings.configuration?.providers;
      const applied = !!rows?.find(
        (row: { id: string }) => row.id === save?.targetId,
      )?.managedCredential?.applied;
      setTicket((current) => (current ? { ...current, applied } : current));
      setError("");
    } catch {
      setError("重新连接未完成，请检查运行状态；凭证不会重复写入。");
    } finally {
      setSending(false);
    }
  }
  const waiting = ticket?.state === "waiting" && !sending;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        sudoPolicy ? "单次提权检查" : save ? "保存私密凭证" : "临时验证 API Key"
      }
      description={
        sudoPolicy
          ? "此窗口由工作台提供。密码仅交给本机独立 sudo 进程，不进入对话、Codex 命令或普通终端，用后丢弃。"
          : save
            ? "此窗口由工作台提供。原值不会回显或交给助手，普通配置只保存引用。"
            : "此窗口由工作台提供。凭证只发送给下方接收方，用后丢弃，不保存到配置，也不交给助手。"
      }
      className="credential-modal"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <div className="credential-scope">
        {!sudoPolicy && (
          <p>
            {save?.scope === "mcp" ? "MCP" : "Provider"}：
            <strong>{providerId}</strong>
          </p>
        )}
        <p>
          {sudoPolicy
            ? "操作：以 root 执行一次 /usr/bin/id -u，只检查身份"
            : save
              ? `操作：${save.retention === "encrypted" ? "加密保存" : "仅当前工作台内存保存"}并重新连接`
              : "操作：一次 GET /models，不创建模型任务"}
        </p>
        <p>
          接收方：<code>{ticket?.receiver || "正在核对…"}</code>
        </p>
        {ticket && (
          <p>
            有效至{" "}
            {new Date(ticket.expiresAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
        )}
      </div>
      <form aria-label="受信私密输入" onSubmit={(event) => void send(event)}>
        <label className="field-label" htmlFor={`credential-${id}`}>
          {sudoPolicy
            ? "本机 sudo 密码"
            : save?.scope === "mcp"
              ? "Bearer Token"
              : save
                ? "API Key"
                : "临时 API Key"}
          <input
            id={`credential-${id}`}
            ref={input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={sudoPolicy ? 1024 : 4096}
            required
            disabled={!waiting}
            aria-describedby={`credential-help-${id}`}
          />
        </label>
        <p id={`credential-help-${id}`} className="muted">
          {sudoPolicy
            ? "仅供本次固定操作。不会建立 sudo 授权缓存；系统不要求密码时，输入不会发送。取消只停止本次检查，已发生的认证不能撤回。"
            : save
              ? "普通配置只写引用，原值不回显。已开始写入的操作无法取消。"
              : "仅支持 Bearer 凭证。不记录上游正文，不跟随重定向。发送后清空输入框；失败时请重新发起。"}
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <p className="credential-status" role="status" aria-atomic="true">
          {ticket ? credentialStatus(ticket) : "正在核对接收方…"}
        </p>
        <div className="modal-actions">
          {save && ticket?.state === "succeeded" && !ticket.applied && (
            <button
              type="button"
              className="secondary"
              disabled={sending}
              onClick={() => void reconnectSaved()}
            >
              重新连接已保存凭证
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => void read()}
            disabled={!ticket || sending}
          >
            读取状态
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (input.current) input.current.value = "";
              void api(path, { method: "DELETE" })
                .then(setTicket)
                .catch(() => setError("取消状态未确认，请读取状态。"));
            }}
            disabled={
              !ticket || ticket.committed || !credentialPending(ticket.state)
            }
          >
            取消本次请求
          </button>
          <button type="submit" className="primary" disabled={!waiting}>
            {sudoPolicy
              ? "授权单次检查"
              : save
                ? "保存并重新连接"
                : "仅验证一次"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
