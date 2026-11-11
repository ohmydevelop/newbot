import { useEffect, useState, useRef } from "react";
import { Modal } from "./ui";
import ChatPrivateInputs from "./ChatPrivateInputs";
import { privateApi } from "../private-input";
import type { Json } from "../../shared/types";
export default function SessionPrivateAccess({
  threadId,
  onClose,
}: {
  threadId: string;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState<Json[]>([]),
    [selected, setSelected] = useState(""),
    [status, setStatus] = useState<Json | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [notice, setNotice] = useState("");
  const id = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    void privateApi(`/api/credentials/threads/${threadId}`)
      .then((value) => {
        if (active) {
          setTargets(value.targets);
          setSelected(
            value.targets[0]
              ? `${value.targets[0].scope}:${value.targets[0].targetId}`
              : "",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      if (id.current)
        void privateApi(`/api/credentials/authorizations/${id.current}`, {
          method: "DELETE",
        }).catch(() => {});
    };
  }, [threadId]);
  async function start() {
    const target = targets.find((t) => `${t.scope}:${t.targetId}` === selected);
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const value = await privateApi(
        `/api/credentials/threads/${threadId}/requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: target.scope,
            targetId: target.targetId,
          }),
        },
      );
      id.current = value.requestId;
      setStatus(value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="会话私密授权"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="connection-editor-modal"
    >
      <p className="muted">
        授权更新后供下一次任务使用。已失败的操作不会自动重新执行。
      </p>
      {status ? (
        <ChatPrivateInputs
          runId={status.requestId}
          status={status}
          authorizationOnly
          onChanged={() => {
            void privateApi(
              `/api/credentials/authorizations/${status.requestId}`,
            )
              .then((value) => {
                if (value.state === "authorized") {
                  setStatus(null);
                  setNotice("会话授权已更新。");
                } else setStatus({ ...status, ...value });
              })
              .catch(() => setStatus(null));
          }}
        />
      ) : (
        <div className="connector-editor">
          <label className="field-label">
            接收方
            <select
              aria-label="接收方"
              value={selected}
              disabled={busy || !targets.length}
              onChange={(e) => setSelected(e.target.value)}
            >
              {targets.map((t) => (
                <option
                  key={`${t.scope}:${t.targetId}`}
                  value={`${t.scope}:${t.targetId}`}
                >
                  {t.receiver}
                </option>
              ))}
            </select>
          </label>
          {!busy && !targets.length && (
            <p className="muted">此会话没有配置私密字段。</p>
          )}
          <div className="editor-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void privateApi(`/api/credentials/threads/${threadId}`, {
                  method: "DELETE",
                })
                  .then(() => setNotice("会话授权已撤销。"))
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              撤销会话授权
            </button>
            <button
              className="primary"
              disabled={busy || !selected}
              onClick={() => void start()}
            >
              更新授权
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </Modal>
  );
}
