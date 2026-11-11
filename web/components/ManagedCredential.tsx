import {responseJson} from "../http";
import { lazy, Suspense, useState, useRef } from "react";
import type { CredentialMetadata } from "../../shared/credentials.js";
import { useApp, loadSettings, request, acceptSettings } from "../store.js";
const CredentialProbe = lazy(() => import("./CredentialProbe.js"));
const labels = {
  none: "未托管凭证",
  memory: "仅保存在本次工作台内存",
  encrypted: "已在本机加密保存",
  missing: "上次内存凭证已丢失，请重新填写",
  locked: "加密凭证已锁定，请检查解密钥或重新填写",
  binding_changed: "绑定或引用已变化，凭证不会载入",
};
export default function ManagedCredential({
  scope,
  targetId,
  revision,
  metadata,
  editable,
}: {
  scope: "provider" | "mcp";
  targetId: string;
  revision: string;
  metadata?: CredentialMetadata;
  editable?: boolean;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  const enabled = useApp((s) => s.credentialManagement),
    encryption = useApp((s) => s.credentialEncryption);
  const [choose, setChoose] = useState(false),
    [input, setInput] = useState(false),
    [retention, setRetention] = useState<"memory" | "encrypted">("memory"),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  if (
    !enabled ||
    !metadata ||
    (!editable && metadata.state === "none" && !metadata.stored)
  )
    return null;
  async function operation(path: "clear" | "apply") {
    if (!metadata) return;
    setBusy(true);
    setNotice("");
    try {
      if (path === "apply" && useApp.getState().runtime === "offline") {
        const recovery = await request<{ settings: any }>(
          "configuration/recover",
          { mode: "reconnect" },
        );
        acceptSettings(recovery.settings);
        setNotice("已重新连接并读取凭证状态。");
        return;
      }
      const response = await fetch("/api/credentials/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          path === "apply"
            ? { expectedRevision: revision }
            : {
                scope,
                targetId,
                expectedRevision: revision,
                expectedVaultVersion: metadata.version,
                confirm: true,
              },
        ),
      });
      if (response.status === 401) useApp.setState({ authenticated: false });
      if (!response.ok) throw new Error();
      const result = await responseJson(response);
      setNotice(
        path === "clear"
          ? result.applied
            ? "凭证已清除并重新连接。"
            : "凭证已清除，运行时未就绪，请重新连接。"
          : "已重新连接并核对凭证。",
      );
      setConfirm(false);
    } catch {
      setNotice("结果尚未确认，请读取配置后再操作；不会自动重复写入。");
    } finally {
      await loadSettings().catch(() => {});
      setBusy(false);
    }
  }
  return (
    <section
      className="managed-credential"
      aria-label={`${scope === "provider" ? "Provider" : "MCP"} ${targetId} 的私密凭证`}
    >
      <p className="muted">
        {labels[metadata.state]}
        {["memory", "encrypted"].includes(metadata.state)
          ? metadata.applied
            ? " · 已载入"
            : " · 尚未载入"
          : ""}
      </p>
      <div className="provider-actions">
        {editable && (
          <button
            ref={opener}
            type="button"
            className="secondary"
            disabled={busy || input}
            onClick={() => {
              if (!choose) setRetention("memory");
              setChoose(!choose);
              setNotice("");
            }}
          >
            {metadata.state === "none" ? "设置私密凭证" : "更新私密凭证"}
          </button>
        )}
        {(metadata.state !== "none" || metadata.stored) && (
          <button
            type="button"
            className="secondary"
            disabled={busy || input}
            onClick={() => setConfirm(true)}
          >
            清除私密凭证
          </button>
        )}
        {metadata.state !== "none" && !metadata.applied && (
          <button
            type="button"
            className="secondary"
            disabled={busy || input}
            onClick={() => void operation("apply")}
          >
            应用并重新连接
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy || input}
          onClick={() =>
            void loadSettings().catch(() =>
              setNotice("配置暂不可读，请稍后重试。"),
            )
          }
        >
          读取凭证状态
        </button>
      </div>
      {choose && !input && (
        <fieldset className="credential-retention">
          <legend>保存方式</legend>
          <label>
            <input
              type="radio"
              name={`retention-${scope}-${targetId}`}
              checked={retention === "memory"}
              onChange={() => setRetention("memory")}
            />
            仅当前工作台运行期间，重启后需重填
          </label>
          <label>
            <input
              type="radio"
              name={`retention-${scope}-${targetId}`}
              checked={retention === "encrypted"}
              disabled={!encryption}
              onChange={() => setRetention("encrypted")}
            />
            在本机加密保存，重启后恢复
          </label>
          {!encryption && (
            <p className="inline-error">
              加密存储当前不可用，请检查服务端解密钥与权限。
            </p>
          )}
          <p className="muted">
            原值不可回读。保存后会重新连接 Codex，请先结束任务和授权。
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setInput(true)}
          >
            继续私密输入
          </button>
        </fieldset>
      )}
      {confirm && (
        <div
          className="credential-clear-confirm"
          role="group"
          aria-label="确认清除私密凭证"
        >
          <p>确认清除？原值无法回读，清除后需要重新填写。</p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            保留凭证
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void operation("clear")}
          >
            确认清除并重连
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
      {input && (
        <Suspense fallback={<p role="status">正在加载私密输入…</p>}>
          <CredentialProbe
            providerId={targetId}
            revision={revision}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              opener.current?.focus();
            }}
            save={{
              scope,
              targetId,
              retention,
              expectedVaultVersion: metadata.version,
            }}
            onClose={() => {
              setInput(false);
              setChoose(false);
              void loadSettings().catch(() => {});
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
