import {
  Component,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ReactCatalogComponent } from "@a2ui/react/v0_9";
import type { A2uiActionInput, A2uiView } from "../../../shared/a2ui-chat.js";
import { A2UI_ACTIONS } from "../../../shared/a2ui-chat.js";
import { A2uiRuntime } from "../../../shared/a2ui-runtime.js";
import { encodeA2ui, a2uiCatalogId } from "../../../shared/a2ui-policy.js";
import { A2uiPanel } from "./Panel.js";
import { createA2uiCatalog } from "./catalog.js";
import { useA2uiDraft } from "./useDraft.js";
import { loadThread, useApp } from "../../store.js";

type Submission = { signature: string; body: A2uiActionInput };
const idleSubscribe = (_listener: () => void) => () => {};
class FormBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">表单无法显示，请重载表单或让助手重新生成。</p>
    ) : (
      this.props.children
    );
  }
}
const unavailable = {
  expired: "表单已过期，请重新生成；已保存的草稿仅供查看",
  runtime_restarted: "服务已重启，旧表单仅供查看，请重新生成",
  runtime_stopped: "服务连接已结束，旧表单仅供查看",
  interrupted: "表单已结束，请重新生成",
  request_resolved: "表单请求已结束，请重新生成",
  incomplete: "表单描述不完整，请让助手重新生成",
  invalid: "表单描述无法安全显示，请让助手重新生成",
  submission_unconfirmed: "提交状态未确认，请检查任务状态；不会重复发送",
};
export default function ChatA2ui({ view }: { view: A2uiView }) {
  const [runtime, setRuntime] =
    useState<A2uiRuntime<ReactCatalogComponent> | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const submission = useRef<Submission | null>(null);
  const latest = useRef(view);
  latest.current = view;
  const connected = useApp(
    (state) => state.connected && state.runtime === "ready",
  );
  useSyncExternalStore(
    runtime?.subscribe || idleSubscribe,
    () => runtime?.revision || 0,
  );
  const [now, setNow] = useState(Date.now());
  const expired = !!view.expiresAt && view.expiresAt <= now;
  const waiting = view.state === "waiting" && !expired;
  const draft = useA2uiDraft(runtime, view, waiting && connected);
  const submitting = cancelling || !!runtime?.busy;
  useEffect(() => {
    if (view.state !== "waiting" || !view.expiresAt) return;
    const timer = setTimeout(
      () => {
        setNow(Date.now());
        void loadThread(view.threadId).catch(() => {});
      },
      Math.max(0, view.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [view.id, view.revision, view.expiresAt]);
  async function send(
    sourceComponentId: string,
    values: Record<string, unknown>,
  ) {
    const current = latest.current;
    if (current.state !== "waiting" || !current.token)
      throw new Error("表单已结束");
    const signature = JSON.stringify({
      id: current.id,
      revision: current.revision,
      sourceComponentId,
      values,
    });
    if (submission.current?.signature !== signature)
      submission.current = {
        signature,
        body: {
          id: current.id,
          threadId: current.threadId,
          turnId: current.turnId,
          itemId: current.itemId,
          surfaceId: current.surfaceId,
          revision: current.revision,
          token: current.token,
          sourceComponentId,
          values,
          requestId: crypto.randomUUID(),
        },
      };
    await draft.pause();
    try {
      const response = await fetch("/api/a2ui/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission.current.body),
      });
      if (!response.ok) {
        if (response.status === 401) useApp.setState({ authenticated: false });
        if (response.status === 400) submission.current = null;
        if (response.status === 409)
          await loadThread(current.threadId).catch(() => {});
        throw new Error("表单未能提交，请检查状态后重试。");
      }
      submission.current = null;
      // The native tool response continues the same turn. Reading the authority
      // also covers a late/lost SSE update without creating another model turn.
      if (useApp.getState().selectedId === current.threadId)
        await loadThread(current.threadId);
    } finally {
      draft.resume();
    }
  }
  useEffect(() => {
    let active = true;
    const r = new A2uiRuntime(createA2uiCatalog(a2uiCatalogId(view.messages)), {
      surfaceId: view.surfaceId,
      allowedActions: A2UI_ACTIONS,
      onAction: async (action) => {
        await send(action.sourceComponentId, r.values());
        if (active) setError("");
      },
    });
    setError("");
    try {
      if (view.messages.length) r.apply(encodeA2ui(view.messages));
      if (view.draft) {
        try {
          r.updateValues(view.draft.values);
        } catch {
          setError("已保存的草稿无法用于此表单，请重新填写。");
        }
      }
      setRuntime(r);
    } catch {
      r.dispose();
      setRuntime(null);
      setError("表单内容未能加载，请重新读取会话。");
    }
    return () => {
      active = false;
      r.dispose();
    };
  }, [view.id, view.revision, reload]);
  return (
    <div
      className="chat-a2ui"
      data-wait-id={`a2ui:${view.id}`}
      onChange={draft.change}
      onBlur={() => void draft.save()}
    >
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {runtime && (
        <FormBoundary key={`${view.id}:${view.revision}:${reload}`}>
          <A2uiPanel
            runtime={runtime}
            disabled={!waiting || !connected || cancelling}
          />
        </FormBoundary>
      )}
      {(view.state !== "display" ||
        [...(runtime?.components().values() || [])].some((c) =>
          ["TextField", "ChoicePicker", "Button"].includes(String(c.component)),
        )) && (
        <div className="a2ui-footer">
          <span role="status" aria-atomic="true">
            {view.state === "waiting"
              ? expired
                ? unavailable.expired
                : connected
                  ? "等待填写"
                  : "连接恢复后可提交"
              : view.state === "submitted"
                ? "已提交"
                : view.state === "cancelled"
                  ? "已取消"
                  : view.state === "unavailable"
                    ? unavailable[view.reason || "interrupted"]
                    : "仅供查看"}
          </span>
          {waiting && view.expiresAt && (
            <small>
              有效至{" "}
              {new Date(view.expiresAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          )}
          {waiting && (
            <button
              type="button"
              disabled={submitting || !connected}
              onClick={() => {
                setCancelling(true);
                void send("$cancel", {})
                  .catch(() => setError("取消状态未确认，请重新读取会话。"))
                  .finally(() => setCancelling(false));
              }}
            >
              取消填写
            </button>
          )}
          {waiting && (
            <>
              <button
                type="button"
                disabled={submitting || !connected || draft.conflict}
                onClick={() => void draft.save()}
              >
                保存草稿
              </button>
              <button
                type="button"
                disabled={submitting || !connected || draft.conflict}
                onClick={() => void draft.save(true)}
              >
                清除草稿
              </button>
            </>
          )}
          <button
            type="button"
            disabled={submitting}
            onClick={() =>
              void loadThread(view.threadId)
                .then(() => setReload((value) => value + 1))
                .catch(() => setError("会话未能重新读取。"))
            }
          >
            重载表单
          </button>
        </div>
      )}
      {draft.status && (
        <p className="a2ui-draft-status" role="status" aria-atomic="true">
          {draft.status}
        </p>
      )}
    </div>
  );
}
