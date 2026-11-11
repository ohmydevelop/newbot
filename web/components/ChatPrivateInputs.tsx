import { useRef, useState } from "react";
import { LockKeyhole, LoaderCircle } from "lucide-react";
import {
  sendPrivateFields,
  PrivateOutcomeUnknown,
  privateApi,
} from "../private-input";
import type { Json } from "../../shared/types";
export default function ChatPrivateInputs({
  runId,
  status,
  onChanged,
  authorizationOnly = false,
}: {
  runId: string;
  status: Json;
  onChanged: () => void;
  authorizationOnly?: boolean;
}) {
  const inputs = useRef(new Map<string, HTMLInputElement>()),
    [duration, setDuration] = useState<"run" | "thread">("run"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [unknown, setUnknown] = useState<string | null>(null);
  async function authorize(e: React.FormEvent) {
    e.preventDefault();
    if (busy || unknown) return;
    setBusy(true);
    setError("");
    try {
      for (const target of status.privateInputs || []) {
        const values: Record<string, string> = {};
        for (const field of target.fields) {
          const name = `${field.kind}:${field.name}`,
            input = inputs.current.get(
              `${target.scope}:${target.targetId}:${name}`,
            );
          if (input?.value) values[name] = input.value;
        }
        await sendPrivateFields(
          {
            operation: "credential.authorize",
            runId,
            scope: target.scope,
            targetId: target.targetId,
            expectedFieldsRevision: target.revision,
            duration: authorizationOnly ? "thread" : duration,
          },
          values,
        );
      }
      for (const input of inputs.current.values()) input.value = "";
      onChanged();
    } catch (err) {
      if (err instanceof PrivateOutcomeUnknown) setUnknown(err.ticketId);
      setError(err instanceof Error ? err.message : "授权未完成");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      await privateApi(
        authorizationOnly
          ? `/api/credentials/authorizations/${runId}`
          : `/api/credentials/runs/${runId}/cancel`,
        { method: authorizationOnly ? "DELETE" : "POST" },
      );
      onChanged();
    } catch {
      setError("取消结果未确认，请查询任务状态。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="chat-private-input" aria-label="任务私密授权">
      <div className="private-input-title">
        <LockKeyhole size={20} />
        <h2>{authorizationOnly ? "更新会话授权" : "需要授权"}</h2>
      </div>
      <p className="muted">凭证只交给下面的接收方，不进入聊天内容。</p>
      <form onSubmit={authorize}>
        {(status.privateInputs || []).map((target: Json) => (
          <fieldset
            key={`${target.scope}:${target.targetId}`}
            disabled={busy || !!unknown}
          >
            <legend>{target.receiver}</legend>
            {target.fields.map((field: Json) => {
              const key = `${target.scope}:${target.targetId}:${field.kind}:${field.name}`;
              return (
                <label className="field-label" key={key}>
                  {field.kind === "bearer" ? "API Key / Token" : field.name}
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    maxLength={4096}
                    onInvalid={(e) =>
                      e.currentTarget.setCustomValidity("请填写此凭证")
                    }
                    onInput={(e) => e.currentTarget.setCustomValidity("")}
                    ref={(node) => {
                      if (node) inputs.current.set(key, node);
                      else inputs.current.delete(key);
                    }}
                  />
                </label>
              );
            })}
          </fieldset>
        ))}
        {!authorizationOnly && (
          <label className="field-label">
            授权范围
            <select
              aria-label="授权范围"
              value={duration}
              disabled={busy || !!unknown}
              onChange={(e) => setDuration(e.target.value as "run" | "thread")}
            >
              <option value="run">仅本次任务</option>
              <option value="thread">当前会话</option>
            </select>
          </label>
        )}
        {duration === "thread" && (
          <p className="muted">会话中可复用；撤销、归档或服务重启后失效。</p>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="editor-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {authorizationOnly ? "取消" : "取消任务"}
          </button>
          {unknown ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void privateApi(`/api/credentials/${unknown}`)
                  .then((ticket) => {
                    if (ticket.state === "succeeded") {
                      setUnknown(null);
                      onChanged();
                    } else if (
                      [
                        "waiting",
                        "failed",
                        "cancelled",
                        "expired",
                        "invalidated",
                      ].includes(ticket.state)
                    ) {
                      setUnknown(null);
                      onChanged();
                      setError("未完成授权，请重新输入。");
                    }
                  })
                  .catch(() => setError("状态暂不可读，请稍后重试。"))
                  .finally(() => setBusy(false));
              }}
            >
              读取授权状态
            </button>
          ) : (
            <button className="primary" disabled={busy}>
              {busy && <LoaderCircle size={16} className="spin" />}
              {authorizationOnly ? "保存授权" : "授权并继续"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
