import { lazy, Suspense, useState, useEffect } from "react";
import {
  AlertCircle,
  LoaderCircle,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import type { Turn } from "../../../shared/types";
import { loadThread } from "../../store";
import { turnFeedback } from "../../chat-presentation";
import { Message } from "./Message";
import { ContentBoundary } from "./ContentBoundary";
const Artifacts = lazy(() =>
  import("../Artifacts").then((m) => ({ default: m.Artifacts })),
);
function TurnFeedback({ turn, threadId }: { turn: Turn; threadId: string }) {
  const [reading, setReading] = useState(false),
    [readError, setReadError] = useState("");
  const [readStatus, setReadStatus] = useState("");
  const feedback = turnFeedback(turn);
  if (!feedback) return null;
  return (
    <div className={`turn-feedback ${feedback.tone}`}>
      <div role="status" aria-atomic="true">
        <p>
          {feedback.tone === "error" && (
            <AlertCircle size={15} aria-hidden="true" />
          )}
          {feedback.text}
        </p>
        {feedback.canRead && (
          <small>可以继续发送消息；读取状态不会重新执行任务。</small>
        )}
        {readStatus && <small>{readStatus}</small>}
      </div>
      {feedback.canRead && (
        <button
          type="button"
          className="secondary"
          disabled={reading}
          onClick={() => {
            setReading(true);
            setReadError("");
            setReadStatus("");
            void loadThread(threadId, false, { localError: true })
              .then(() => setReadStatus("状态已更新。"))
              .catch(() => setReadError("状态未能读取，请恢复连接后重试。"))
              .finally(() => setReading(false));
          }}
        >
          {reading ? (
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
          ) : (
            <RefreshCw size={15} aria-hidden="true" />
          )}
          {reading ? "正在读取…" : "重新读取状态"}
        </button>
      )}
      {readError && (
        <p className="inline-error" role="alert">
          {readError}
        </p>
      )}
    </div>
  );
}
export function ChatTurn({
  turn,
  threadId,
  canAdd,
}: {
  turn: Turn;
  threadId: string;
  canAdd: boolean;
}) {
  const [expanded, setExpanded] = useState(false),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (turn.status !== "inProgress") return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [turn.status]);
  const isProcess = (item: Turn["items"][number]) =>
    item.phase === "commentary" ||
    [
      "reasoning",
      "commandExecution",
      "fileChange",
      "mcpToolCall",
      "webSearch",
      "plan",
      "dynamicToolCall",
    ].includes(item.type);
  const firstProcess = turn.items.findIndex(isProcess);
  const elapsed =
    turn.durationMs ??
    (turn.startedAt != null &&
    (turn.completedAt != null || turn.status === "inProgress")
      ? Math.max(0, (turn.completedAt ?? clock / 1000) - turn.startedAt) * 1000
      : null);
  const label =
    elapsed === null
      ? "时长未知"
      : `${Math.floor(elapsed / 60000) > 0 ? `${Math.floor(elapsed / 60000)} 分 ` : ""}${Math.floor(elapsed / 1000) % 60} 秒`;
  return (
    <div
      className={`turn ${expanded ? "process-expanded" : "process-collapsed"}`}
      data-turn-id={turn.id}
    >
      {turn.items.map((item, index) => (
        <ContentBoundary key={item.id}>
          {index === firstProcess && (
            <button
              type="button"
              className="process-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronRight size={15} />
              <span>
                {turn.status === "inProgress" ? "正在处理" : "执行过程"} ·{" "}
                {label}
              </span>
            </button>
          )}
          <Message item={item} threadId={threadId} turnId={turn.id} />
        </ContentBoundary>
      ))}
      {!!(turn.artifacts?.length || turn.artifactNotices?.length) && (
        <ContentBoundary>
          <Suspense
            fallback={
              <p className="muted" role="status">
                正在加载文件…
              </p>
            }
          >
            <Artifacts threadId={threadId} turn={turn} canAdd={canAdd} />
          </Suspense>
        </ContentBoundary>
      )}
      {turn.status === "inProgress" && firstProcess < 0 && (
        <button
          type="button"
          className="process-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
          <span>正在处理 · {label}</span>
        </button>
      )}
      <TurnFeedback turn={turn} threadId={threadId} />
    </div>
  );
}
