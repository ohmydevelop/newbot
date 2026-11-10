import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui";
import { request, loadThreads, useApp } from "../../store";
export function RenameDialog({
  id,
  title,
  onClose,
}: {
  id: string;
  title: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(title),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true),
    posting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <Modal
      open
      title="重命名对话"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (posting.current || !name.trim()) return;
          posting.current = true;
          setBusy(true);
          setError("");
          const value = name.trim();
          void request("thread/name/set", { threadId: id, name: value })
            .then(() => {
              useApp.setState((s) => ({
                threads: s.threads.map((t) =>
                  t.id === id ? { ...t, title: value } : t,
                ),
                thread:
                  s.thread?.id === id ? { ...s.thread, name: value } : s.thread,
              }));
              if (mounted.current) onClose();
              void loadThreads().catch(() => {});
            })
            .catch(() => {
              if (mounted.current)
                setError("名称未能确认，草稿已保留。请刷新列表核对后重试。");
            })
            .finally(() => {
              posting.current = false;
              if (mounted.current) setBusy(false);
            });
        }}
      >
        <label className="field-label">
          对话名称
          <input
            autoFocus
            data-autofocus
            value={name}
            maxLength={120}
            disabled={busy}
            aria-describedby={error ? "rename-error" : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p id="rename-error" className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          {error && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadThreads().catch(() => {})}
            >
              刷新列表
            </button>
          )}
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? "正在保存…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
